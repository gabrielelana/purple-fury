const express = require('express')
const app = express()
const server = require('http').Server(app)
const cors = require('cors')
const io = require('socket.io')(server)
const { check, body, validationResult } = require('express-validator/check');

const Database = require('nedb')
const users = new Database({inMemoryOnly: true, timestampData: true})
const messages = new Database({inMemoryOnly: true, timestampData: true})
const rooms = new Database({inMemoryOnly: true, timestampData: true})

const moment = require('moment')
const bcrypt = require('bcrypt')
const util = require('util')

var sockets = new Map()

app.use(express.static('public'))
app.use(require('body-parser').json())
app.use(require('cookie-parser')())
app.use(cors())

function login(credentials, users, callback) {
  const saltRounds = 5
  users.findOne({username: credentials.username}, (err, user) => {
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
        const user = {
          username: credentials.username,
          password: hashedPassword,
          rooms: [],
          preferences: {},
          profile: {},
        }
        users.insert(user, (err, user) => {
          if (err) return callback(err)
          console.log('created:', user)
          callback(null, user)
        })
      })
    }
  })
}

function credentials(credentials, _users, callback) {
  if (credentials.username && credentials.password) {
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

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({errors: errors.mapped()})
  }
  next()
}

app.post(
  '/login',
  [
    body('username').optional().matches(/[-_a-zA-Z0-9.]+/).isLength({min: 3}),
    body('password').optional().isString().isLength({min: 3}),
    validate,
  ],
  (req, res) => {
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
        res.status(200).cookie('token', user._id).json({...user, token: user._id})
      })
    })
  })

app.post(
  '/messages',
  authenticate,
  [
    body('message').isString().isLength({min: 1}),
    body('room').optional().isAlphanumeric().isLength({min: 3}),
    validate
  ],
  (req, res) => {
    const message = {
      username: req.authenticatedUser.username,
      message: req.body.message,
      room: req.body.room || 'main',
    }
    // TODO: remove duplication of access to a room
    rooms.findOne({name: message.room}, (err, room) => {
      if (err) return res.status(500).end()
      if (!room) return res.status(404).json({error: 'Room not found'})
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

app.post(
  '/rooms',
  authenticate,
  [
    body('name').matches(/[-_a-zA-Z0-9.]+/).isLength({min: 3}),
    body('topic').isString().isLength({min: 3}),
    body('isPrivate').optional().isBoolean(),
    validate
  ],
  (req, res) => {
    const roomToCreate = {
      name: req.body.name,
      topic: req.body.topic,
      isPrivate: req.body.isPrivate || false,
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

app.post(
  '/rooms/:room/users',
  authenticate,
  [
    body('username').optional().matches(/[-_a-zA-Z0-9.]+/).isLength({min: 3}),
    validate,
  ],
  (req, res) => {
    // TODO: remove duplication of access to a room
    rooms.findOne({$or: [{name: req.params.room}, {_id: req.params.room}]}, (err, room) => {
      if (err) return res.status(500).end()
      if (!room) return res.status(404).end()
      if (room.isPrivate && !req.authenticatedUser.rooms.includes(room.name)) return res.status(401).json({error: 'Room is private'})
      if (!room.isPrivate) res.status(200).json(room)
      users.update({username: req.body.username}, {$addToSet: {rooms: room.name}}, {}, (err, numAffected) => {
        if (err) return res.status(500).end()
        if (numAffected === 0) return res.status(404).end()
        res.status(200).json(room)
      })
    })
  })

app.get('/rooms', authenticate, (req, res) => {
  rooms.find({$or: [{isPrivate: false}, {isPrivate: true, name: {$in: req.authenticatedUser.rooms}}]}, (err, rooms) => {
    res.status(200).json({
      rooms: rooms.map(({name, topic, isPrivate}) => ({name, topic, isPrivate}))
    })
  })
})

app.get('/rooms/:room', authenticate, (req, res) => {
  // TODO: remove duplication of access to a room
  rooms.findOne({$or: [{name: req.params.room}, {_id: req.params.room}]}, (err, room) => {
    if (err) return res.status(500).end()
    if (!room) return res.status(404).end()
    if (room.isPrivate && !req.authenticatedUser.rooms.includes(room.name)) return res.status(401).json({error: 'Room is private'})
    res.status(200).json(room)
  })
})

app.get('/rooms/:room/messages', authenticate, (req, res) => {
  // TODO: remove duplication of access to a room
  rooms.findOne({$or: [{name: req.params.room}, {_id: req.params.room}]}, (err, room) => {
    if (err) return res.status(500).end()
    if (!room) return res.status(404).end()
    if (room.isPrivate && !req.authenticatedUser.rooms.includes(room.name)) return res.status(401).json({error: 'Room is private'})
    messages.find({room: room.name}).sort({createdAt: 1}).exec((err, messages) => {
      if (err) return res.status(500).end()
      res.status(200).json({messages})
    })
  })
})

app.get('/messages', authenticate, (req, res) => {
  rooms.find({$or: [{isPrivate: false}, {isPrivate: true, name: {$in: req.authenticatedUser.rooms}}]}, (err, rooms) => {
    if (err) return res.status(500).end()
    const accessibleRooms = rooms.map(({name}) => name)
    messages.find({room: {$in: accessibleRooms}}).sort({createdAt: 1}).exec((err, messages) => {
      if (err) return res.status(500).end()
      res.status(200).json({messages})
    })
  })
})

app.get('/users', (req, res) => {
  users.find({}, (err, rooms) => {
    if (err) return res.status(500).end()
    res.status(200).json({
      users: rooms.map(({_id, username, profile}) => ({username, profile, isConnected: sockets.has(_id)}))
    })
  })
})

app.put(
  '/users/:user/preferences',
  authenticate,
  [
    body('preferences').exists().custom((value) => typeof value === 'object' && value.constructor === Object),
    validate,
  ],
  (req, res) => {
    users.findOne({$or: [{username: req.params.user}, {_id: req.params.user}]}, (err, user) => {
      if (!user) return res.status(404).end()
      if (req.authenticatedUser._id !== user._id) return res.status(401).end()
      users.update({_id: user._id}, {$set: {preferences: req.body.preferences}}, {}, (err) => {
        if (err) return res.status(500).end()
        res.status(200).json(req.body.preferences)
      })
    })
  })

app.get('/users/:user/preferences', authenticate, (req, res) => {
  users.findOne({$or: [{username: req.params.user}, {_id: req.params.user}]}, (err, user) => {
    if (!user) return res.status(404).end()
    if (req.authenticatedUser._id !== user._id) return res.status(401).end()
    res.status(200).json(user.preferences)
  })
})

app.put(
  '/users/:user/profile',
  authenticate,
  [
    body('profile').exists().custom((value) => typeof value === 'object' && value.constructor === Object),
    validate,
  ],
  (req, res) => {
    users.findOne({$or: [{username: req.params.user}, {_id: req.params.user}]}, (err, user) => {
      if (!user) return res.status(404).end()
      if (req.authenticatedUser._id !== user._id) return res.status(401).end()
      users.update({_id: user._id}, {$set: {profile: req.body.profile}}, {}, (err) => {
        if (err) return res.status(500).end()
        res.status(200).json(req.body.profile)
      })
    })
  })

io.origins('*:*')

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
    if (socketsForUser.length === 1) {
      io.emit('users', {
        user: {
          username: user.username,
          profile: user.profile,
          isConnected: true,
        },
        event: 'user-is-online'
      })
    }
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
    // TODO: consider to user username instead of _id
    if (socketsForUser.length === 0) {
      sockets.delete(token)
      users.findOne({_id: token}, (err, user) => {
        if (!err && user) {
          io.emit('users', {
            user: {
              username: user.username,
              profile: user.profile,
              isConnected: true,
            },
            event: 'user-went-offline'
          })
        }
      })
    }
  })
})

rooms.insert({name: 'main', topic: 'main', isPrivate: false}, (err, _room) => {
  server.listen(4000, () => {
    console.log('The server is running: http://localhost:4000')
  })
})

setInterval(
  () => {
    messages.remove({createdAt: {$lt: moment().subtract(30, 'minutes')}}, {multi: true}, (err, numRemoved) => {
      if (!err) {
        console.log(`removed ${numRemoved} old messages`)
      }
    })
  },
  30000
)
