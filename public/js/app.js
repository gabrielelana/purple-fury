$(() => {
  const username = 'gabriele'
  const password = 'secret'

  // TODO: extract login function
  superagent
    .post('/login')
    .send({username, password})
    .end((err, res) => {
      console.log('login', res)

      if (res.status === 200) {
        const socket = io({query: {token: res.body.token}})

        $('form').submit(() => {
          socket.emit('messages', $('#m').val())
          $('#m').val('')
          return false
        })

        socket.on('messages', msg => {
          $('#messages').append($('<li>').text(msg))
        })
      }

      // // login again
      // setTimeout(
      //   () => {
      //     console.log('login again')
      //     superagent
      //       .post('/login')
      //       .send({username, password})
      //       .end((err, res) => {
      //         console.log('login', res)
      //       })
      //   },
      //   5000
      // )

      // setTimeout(
      //   () => {
      //     console.log('login again')
      //     superagent
      //       .post('/login')
      //       .send({username, password: 'wrong password'})
      //       .end((err, res) => {
      //         console.log('login', res)
      //       })
      //   },
      //   10000
      // )

      // setTimeout(
      //   () => {
      //     console.log('anonymous loging')
      //     superagent
      //       .post('/login')
      //       .send()
      //       .end((err, res) => {
      //         console.log('login', res)
      //       })
      //   },
      //   15000
      // )
    })
})
