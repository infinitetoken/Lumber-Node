/* eslint-disable no-console */
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in test:', reason)
})
