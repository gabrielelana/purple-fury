const app = require('express')()
const server = require('http').Server(app)

app.get('/', (req, res) => {
  res.send('<h1>Hello world!</h1>')
})

server.listen(4000, () => {
  console.log('The server is running: http://localhost:4000')
})
