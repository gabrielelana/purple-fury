const express = require('express')
const app = express()
const server = require('http').Server(app)
const io = require('socket.io')(server)

const Database = require('nedb')
const db = new Database({inMemoryOnly: true, timestampData: true})

const bcrypt = require('bcrypt')
const util = require('util')

app.use(express.static('public'))
app.use(require('body-parser').json())

function login(credentials, users, callback) {
  const saltRounds = 5
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

  // TODO: check for duplicates in storage
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
  credentials({username: req.body.username, password: req.body.password}, db, (err, credentials) => {
    login(credentials, db, (err, user) => {
      if (err && err.error === 'wrong-password') {
        return res.status(401).json({
          error: "Wrong password, if you tried to create an account then the username is already taken"
        })
      }
      if (err) {
        return res.status(500)
      }
      res.status(200).json({username: user.username, id: user._id})
    })
  })
})

io.on('connection', socket => {
  console.log('user connected')

  socket.on('messages', msg => {
    io.emit('messages', msg)
  })

  socket.on('disconnect', () => {
    console.log('user disconnected')
  })
})

server.listen(4000, () => {
  console.log('The server is running: http://localhost:4000')
})
