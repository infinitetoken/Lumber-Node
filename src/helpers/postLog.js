const { post } = require('axios'),
  { server } = require('../configs')

module.exports = async (token, data) => {
  if (!token) return
  try {
    const result = await post(`${server.domain}/logs`, data, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    })
    return result
  } catch(err) {
    if (err.response.status === 401) console.log('Lumber app token invalid')
    if (err.response.status === 402) console.log('Lumber requires user payment')
  }
}
