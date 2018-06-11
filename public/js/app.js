function login(username, password, callback) {
  superagent
    .post('/login')
    .send({username, password})
    .end((err, res) => {
      console.log('login', err, res)
      if (res.status === 200) {
        const token = res.body.token
        const socket = io({query: {token}})
        return callback(null, {token, socket})
      }
      return callback('Unable to login')
    })
}

function createRoom(token, name, topic, isPrivate, callback) {
    superagent
    .post('/rooms')
    .send({token, name, topic, isPrivate})
    .end((err, res) => {
      console.log('create-room', err, res)
      callback(err)
    })
}

function postMessage(token, room, message, callback) {
  superagent
    .post('/messages')
    .send({token, room, message})
    .end((err, res) => {
      console.log('post-message', err, res)
      callback(err)
    })
}

function inviteUser(token, room, username, callback) {
  superagent
    .post('/rooms/' + room + '/users')
    .send({token, username})
    .end((err, res) => {
      console.log('invite-user', err, res)
      callback(err)
    })
}

function updatePreferences(token, username, preferences, callback) {
  superagent
    .put('/users/' + username + '/preferences')
    .send({token, preferences})
    .end((err, res) => {
      console.log('udpate-preferences', err, res)
      callback(err, res.body.preferences)
    })
}

function listOfRooms(token, callback) {
  superagent
    .get('/rooms?token=' + token)
    .end((err, res) => {
      console.log('list-of-rooms', err, res)
      callback(err, res.body.rooms)
    })
}

function listOfUsers(token, callback) {
  superagent
    .get('/users?token=' + token)
    .end((err, res) => {
      console.log('list-of-users', err, res)
      callback(err, res.body.users)
    })
}

function listOfMessages(token, room, callback) {
  superagent
    .get('/rooms/' + room + '/messages?token=' + token)
    .end((err, res) => {
      console.log('list-of-messages', err, res)
      callback(err, res.body.messages)
    })
}


$(() => {

  login('gabriele', 'secret', (err, {token, socket}) => {
    if (err) return console.log(err)

    createRoom(token, 'gossip', 'gossip', true, (err) => {
      if (err) return err
      inviteUser(token, 'gossip', 'chiara', (err) => {
        if (err) return err
        listOfRooms(token, (err, rooms) => {
          if (err) return err
          console.log('rooms', rooms)
        })
        postMessage(token, 'gossip', 'this must stay between us', (err) => {
          if (err) return err
        })
      })
    })

    $('form').submit(() => {
      const message = $('#m').val()
      postMessage(token, 'main', message, (err) => {
        $('#m').val('')
      })
      return false
    })

    socket.on('messages', data => {
      $('#messages').append($('<li>').text(data.room + ':' + data.username + '> ' + data.message))
    })

    socket.on('users', data => {
      // user-is-online
      // user-went-offline
      // user-went-away
      if (data.event === 'user-is-online') {
        $('#messages').append($('<li>').text('*** ' + data.username + ' is online'))
      } else if (data.event === 'user-went-offline') {
        $('#messages').append($('<li>').text('*** ' + data.username + ' went offline'))
      } else {
        $('#messages').append($('<li>').text('*** ' + data.username + ' ???'))
      }
    })
  })

  login('chiara', 'secret', (err, {token, socket}) => {
    if (err) return console.log(err)

    updatePreferences(token, 'chiara', {strawberryCream: true}, (err, preferences) => {
      if (err) return err
      console.log('preferences', preferences)
    })

    setTimeout(
      () => {
        postMessage(token, 'gossip', 'sure thing ;-)', (err) => {
          if (err) return err
        })
        listOfUsers(token, (err, users) => {
          if (err) return err
          console.log('users', users)
        })
      },
      5000
    )
  })

  setTimeout(
    () => {
      login('roberto', 'secret', (err, {token, socket}) => {
        setTimeout(
          () => {
            socket.disconnect()
            setTimeout(
              () => {
                listOfUsers(token, (err, users) => {
                  if (err) return err
                  console.log('users', users)
                })
                setTimeout(
                  () => {
                    login('roberto', 'secret', (err, {token, socket}) => {
                      setTimeout(
                        () => {
                          listOfUsers(token, (err, users) => {
                            if (err) return err
                            console.log('users', users)
                            listOfMessages(token, 'main', (err, messages) => {
                              if (err) return err
                              console.log('messages', messages)
                            })
                          })
                        },
                        1000
                      )
                    })
                  },
                  1000
                )
              }, 1000
            )
          },
          1000
        )
      })
    },
    10000
  )
})
