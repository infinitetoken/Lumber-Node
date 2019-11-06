# Lumber

Lumber is a cloud service for logs

## Installation

Use the package manager [npm](https://www.npmjs.com) to install lumber.

```bash
npm install --save @infinitetoken/lumber
```

## Usage

Import the lumber package and initialize it with your app token.

```javascript
const lumber = require('@infinitetoken/lumber')('your_app_token')
```

Create some logs with one of six levels.

```javascript
lumber.info('info')
lumber.debug('debug')
lumber.verbose('verbose')
lumber.warning('warning')
lumber.error('error')
lumber.critical('critical')
```

Optionally send stringified 'code' to any of log methods.

```javascript
lumber.info('info', JSON.stringify({ key: 'value' }, null, 2))
```

## License
[MIT](https://choosealicense.com/licenses/mit/)
