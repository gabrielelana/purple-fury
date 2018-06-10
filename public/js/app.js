$(() => {
  const username = 'gabriele'
  const password = 'secret'

  // TODO: extract login function
  superagent
    .post('/login')
    .send({username, password})
    .end((err, res) => {
      if (res.status === 200) {
        console.log('login', res)
        const token = res.body.token
        const socket = io({query: {token}})

        superagent
          .post('/rooms')
          .send({token, name: 'random', topic: 'something to chat about'})
          .end((err, res) => {
            console.log('create room', res)
          })

        $('form').submit(() => {
          const message = $('#m').val()
          superagent
            .post('/messages')
            .send({token, message})
            .end((err, res) => {
              $('#m').val('')
            })

          return false
        })

        socket.on('messages', data => {
          $('#messages').append($('<li>').text(data.message))
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
