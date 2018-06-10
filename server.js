const express = require('express')
const app = express()
const server = require('http').Server(app)
const io = require('socket.io')(server)

const Database = require('nedb')
const users = new Database({inMemoryOnly: true, timestampData: true})
const messages = new Database({inMemoryOnly: true, timestampData: true})
const rooms = new Database({inMemoryOnly: true, timestampData: true})

const bcrypt = require('bcrypt')
const util = require('util')

var sockets = new Map()

app.use(express.static('public'))
app.use(require('body-parser').json())
app.use(require('cookie-parser')())

function login(credentials, users, callback) {
  const saltRounds = 5
  // TODO: use findOne
  users.find({username: credentials.username}, (err, [user]) => {
    if (err) return callback(err)
    if (user) {
      bcrypt.compare(credentials.password, user.password, (err, correctPassword) => {
        if (err) return callback(err)
        if (correctPassword) {
          console.log('found:', user)
          return callback(null, user)
        }
        console.log('wrong password')
        return callback({error: 'wrong-password'})
      })
    } else {
      bcrypt.hash(credentials.password, saltRounds, function(err, hashedPassword) {
        if (err) return callback(err)
        users.insert({username: credentials.username, password: hashedPassword, rooms: []}, (err, user) => {
          if (err) return callback(err)
          console.log('created:', user)
          callback(null, user)
        })
      })
    }
  })
}

function credentials(credentials, _users, callback) {
  if (credentials.username || credentials.password) {
    return callback(null, credentials)
  }
  require('crypto').randomBytes(2, (err, buffer) => {
    if (err) return callback(err)
    const username = util.format('user-%s', buffer.toString('hex').toUpperCase())
    require('crypto').randomBytes(8, (err, buffer) => {
      if (err) return callback(err)
      const password = buffer.toString('hex')
      return callback(null, {username, password})
    })
  })
}

function authenticate(req, res, next) {
  const token = req.body.token || req.query.token || req.cookies.token
  if (!token) return res.status(401).json({error: 'Missing authentication token'})
  users.findOne({_id: token}, (err, user) => {
    if (err) return res.status(500).end()
    if (!user) return res.status(401).json({error: 'Wrong authentication token'})
    req.authenticatedUser = user
    next()
  })
}

app.post('/login', (req, res) => {
  credentials({username: req.body.username, password: req.body.password}, users, (err, credentials) => {
    login(credentials, users, (err, user) => {
      if (err && err.error === 'wrong-password') {
        return res.status(401).json({
          error: 'Wrong password, if you tried to create an account then the username is already taken'
        })
      }
      if (err) {
        return res.status(500).end()
      }
      res.status(200).cookie('token', user._id).json({username: user.username, token: user._id})
    })
  })
})

app.post('/messages', authenticate, (req, res) => {
  // TODO: validate parameters
  const message = {
    username: req.authenticatedUser.username,
    message: req.body.message,
    room: req.body.room || 'main',
  }
  // TODO: remove duplication of access to a room
  rooms.findOne({name: message.room}, (err, room) => {
    if (err) return res.status(500).end()
    if (!room) return res.status(404).json('Room not found')
    if (room.isPrivate && !req.authenticatedUser.rooms.includes(room.name)) return res.status(401).json({error: 'Room is private'})
    messages.insert(message, (err, message) => {
      if (err) return res.status(500).end()
      if (room.isPrivate) {
        users.find({rooms: room.name}, (err, usersWithAccess) => {
          if (err) return res.status(500).end()
          usersWithAccess.map((userWithAccess) => {
            if (sockets.has(userWithAccess._id)) {
              sockets.get(userWithAccess._id).forEach(socket => socket.emit('messages', message))
            }
          })
          res.status(201).location(`/messages/${message._id}`).json(message)
        })
      } else {
        io.emit('messages', message)
        res.status(201).location(`/messages/${message._id}`).json(message)
      }
    })
  })
})

app.post('/rooms', authenticate, (req, res) => {
  // TODO: validate parameters
  const roomToCreate = {
    name: req.body.name,
    topic: req.body.topic,
    isPrivate: req.body.isPrivate || false,
    owner: req.authenticatedUser.username,
  }
  rooms.findOne({name: roomToCreate.name}, (err, roomFound) => {
    if (err) return res.status(500).end()
    if (roomFound) return res.status(302).location(`/rooms/${roomFound._id}`).json(roomFound)

    rooms.insert(roomToCreate, (err, roomCreated) => {
      if (err) return res.status(500).end()
      if (roomCreated.isPrivate) {
        users.update({_id: req.authenticatedUser._id}, {$addToSet: {rooms: roomCreated.name}}, {}, (err) => {
          if (err) return res.status(500).end()
          res.status(201).location(`/rooms/${roomCreated.name}`).json(roomCreated)
        })
      } else {
        res.status(201).location(`/rooms/${roomCreated.name}`).json(roomCreated)
      }
    })
  })
})

app.post('/rooms/:name/users', authenticate, (req, res) => {
  // TOOD: validate parameters
  // TODO: remove duplication of access to a room
  rooms.findOne({$or: [{name: req.params.name}, {_id: req.params.name}]}, (err, room) => {
    if (err) return res.status(500).end()
    if (!room) return res.status(404).end()
    if (room.isPrivate && !req.authenticatedUser.rooms.includes(room.name)) return res.status(401).json({error: 'Room is private'})
    users.update({username: req.body.username}, {$addToSet: {rooms: room.name}}, {}, (err, numAffected) => {
      if (err) return res.status(500).end()
      if (numAffected === 0) return res.status(404).end()
      res.status(200).json(room)
    })
  })
})

app.get('/rooms/:name', authenticate, (req, res) => {
  // TODO: remove duplication of access to a room
  rooms.findOne({$or: [{name: req.params.name}, {_id: req.params.name}]}, (err, room) => {
    if (err) return res.status(500).end()
    if (!room) return res.status(404).end()
    if (room.isPrivate && !req.authenticatedUser.rooms.includes(room.name)) return res.status(401).json({error: 'Room is private'})
    res.status(200).json(room)
  })
})

io.use((socket, next) => {
  const token = socket.handshake.query.token;
  users.findOne({_id: token}, (err, user) => {
    if (err) return next(err)
    if (!user) return next(new Error(
      'Authentication failed, token in not associated to any known user, please try to login again'
    ));
    // create association between token and socket
    // TODO: extract
    let socketsForUser = sockets.get(token) || []
    socketsForUser.push(socket)
    sockets.set(token, socketsForUser)
    return next();
  })
})

io.on('connection', socket => {
  console.log('socket connected', {token: socket.handshake.query.token, id: socket.id})

  socket.on('disconnect', () => {
    console.log('socket disconnected', {token: socket.handshake.query.token, id: socket.id})
    // remove association between token and socket
    // TODO: extract
    const token = socket.handshake.query.token;
    let socketsForUser = sockets.get(token) || []
    socketsForUser = socketsForUser.filter(socketForUser => socketForUser.id !== socket.id)
    sockets.set(token, socketsForUser)
  })
})

rooms.insert({name: 'main', isPrivate: false, owner: '_root_'}, (err, _room) => {
  server.listen(4000, () => {
    console.log('The server is running: http://localhost:4000')
  })
})
