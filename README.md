# Lumber

Cloud logging for NodeJS

- [Installation](#installation)
- [Usage](#usage)
- [App](#app)
- [License](#license)

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

Optionally send stringified 'code' to any of the lumber methods.

```javascript
lumber.info('info', JSON.stringify({ key: 'value' }, null, 2))
```

## App

Lumber has a companion app available for MacOS, Windows, and LInux for viewing messages and errors logged to the cloud by using an optional API key. 
An API key can be obtained by creating a new app instance in the Lumber app.

![Lumber Screenshot](https://github.com/infinitetoken/Lumber-Swift/blob/master/Lumber.png)

[Download the Lumber app](https://www.infinitetoken.com/apps/lumber)

## License

Lumber is released under the MIT license. [See LICENSE](https://github.com/infinitetoken/Lumber-Node/blob/master/LICENSE) for details.
