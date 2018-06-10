const express = require('express')
const app = express()
const server = require('http').Server(app)
const io = require('socket.io')(server)

const Database = require('nedb')
const users = new Database({inMemoryOnly: true, timestampData: true})
const messages = new Database({inMemoryOnly: true, timestampData: true})

const bcrypt = require('bcrypt')
const util = require('util')

var sockets = new Map()

app.use(express.static('public'))
app.use(require('body-parser').json())

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
        users.insert({username: credentials.username, password: hashedPassword}, (err, user) => {
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

app.post('/login', (req, res) => {
  credentials({username: req.body.username, password: req.body.password}, users, (err, credentials) => {
    login(credentials, users, (err, user) => {
      if (err && err.error === 'wrong-password') {
        return res.status(401).json({
          error: "Wrong password, if you tried to create an account then the username is already taken"
        })
      }
      if (err) {
        return res.status(500)
      }
      res.status(200).json({username: user.username, token: user._id})
    })
  })
})

function authenticate(req, res, next) {
  if (!req.body.token) return res.status(401).json({error: 'Missing authentication token'})
  users.findOne({_id: req.body.token}, (err, user) => {
    if (err) return res.status(500)
    if (!user) return res.status(401).json({error: 'Wrong authentication token'})
    req.authenticatedUser = user
    next()
  })
}

app.post('/messages', authenticate, (req, res) => {
  // TODO: validate parameters
  const message = {
    username: req.authenticatedUser.username,
    message: req.body.message,
    room: req.body.room || 'main',
  }
  messages.insert(message, (err, message) => {
    if (err) return res.status(500)

    io.emit('messages', message)
    res.status(201).location(`/messages/${message._id}`).json(message)
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
    sockets.set(token, socket)
    return next();
  })
})

io.on('connection', socket => {
  console.log('socket connected', {token: socket.handshake.query.token, id: socket.id})

  socket.on('disconnect', () => {
    console.log('socket disconnected', {token: socket.handshake.query.token, id: socket.id})
    // remove association between token and socket
    sockets.delete(socket.handshake.query.token)
  })
})

server.listen(4000, () => {
  console.log('The server is running: http://localhost:4000')
})
