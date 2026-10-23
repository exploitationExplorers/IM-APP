// Runs only inside the separate test MongoDB, not against a supplied connection URL.
const password = process.env.TEST_MONGO_APP_PASSWORD
if (!password) throw new Error('Test MongoDB application password is required')
const testDatabase = db.getSiblingDB('openim_oss_test')
testDatabase.createUser({
  user: 'im_oss_test',
  pwd: password,
  roles: [
    { role: 'readWrite', db: 'openim_oss_test' },
    { role: 'dbAdmin', db: 'openim_oss_test' },
  ],
})
