const lumber = require('./')(''),
  faker = require('faker')

const timeout = (s) => new Promise(resolve => setTimeout(resolve, s * 1000))

const test = async (n) => {
  while (n === undefined || n >= 0) {
    const code = Math.random() > 0.75 ? JSON.stringify({
      string: faker.lorem.sentences(),
      number: faker.random.number(),
      boolean: faker.random.boolean()
    }, null, 2) : null
    const level = Math.random() * 6
    if (level < 1) {
      lumber.info(faker.lorem.sentence(), code)
    } else if (level < 2) {
      lumber.debug(faker.lorem.sentence(), code)
    } else if (level < 3) {
      lumber.verbose(faker.lorem.sentence(), code)
    } else if (level < 4) {
      lumber.warning(faker.lorem.sentence(), code)
    } else if (level < 5) {
      lumber.error(faker.lorem.sentence(), code)
    } else {
      lumber.critical(faker.lorem.sentence(), code)
    }
    await timeout(2)
    if (!isNaN(n)) n--
  }
  // lumber.cloud = false
  // lumber.debug('Debug')
  // lumber.verbose('Verbose')
  // lumber.warning('Warning')
  // lumber.error('Error')
  // // lumber.cloud = true
  // // lumber.local = false
  // lumber.critical('Critical')
}

test()
