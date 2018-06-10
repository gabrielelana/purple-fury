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


$(() => {

  login('gabriele', 'secret', (err, {token, socket}) => {
    if (err) return console.log(err)

    createRoom(token, 'gossip', 'gossip', true, (err) => {
      if (err) return err
      inviteUser(token, 'gossip', 'chiara', (err) => {
        if (err) return err
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
  })

  login('chiara', 'secret', (err, {token, socket}) => {
    if (err) return console.log(err)

    setTimeout(
      () => {
        postMessage(token, 'gossip', 'sure thing ;-)', (err) => {
          if (err) return err
        })
      },
      5000
    )
  })

})
