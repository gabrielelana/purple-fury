$(() => {
  var socket = io()

  $('form').submit(() => {
    socket.emit('messages', $('#m').val())
    $('#m').val('')
    return false
  })

  socket.on('messages', msg => {
    $('#messages').append($('<li>').text(msg))
  })
})
