const lumber = require('./')('076a03f0fc1211e9afcebd76c90839f3')
const test = async () => {
  const result = await lumber.info('Info', JSON.stringify({
    code: {
      string: 'string',
      number: 0,
      boolean: false
    }
  }, null, 2))
  console.log(result)
  lumber.cloud = false
  lumber.debug('Debug')
  lumber.verbose('Verbose')
  lumber.warning('Warning')
  lumber.error('Error')
  lumber.cloud = true
  lumber.local = false
  lumber.critical('Critical')
}
test()
