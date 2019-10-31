const { request } = require('https'),
  { server } = require('../configs')

module.exports = (token, data) => {
  return new Promise((resolve, reject) => {
    data = JSON.stringify(data)

    const req = request(`${server.domain}/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': `Bearer ${token}`
      }
    }, (res) => {
      if (res.statusCode === 401) console.log('Lumber app token invalid')
      if (res.statusCode === 402) console.log('Lumber requires user payment')
      res.on('data', (d) => resolve(JSON.parse(d.toString())))
    })

    req.on('error', (err) => console.log(err))

    req.write(data)
    req.end()
  })
}
