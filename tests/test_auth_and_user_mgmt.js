const assert = require('assert');
const request = require('supertest');
const app = require('../src/server');

async function runAuthTests() {
  console.log('--- TEST SUITE 11: DATABASE-BACKED AUTHENTICATION & USER MANAGEMENT ---');

  // 1. Test Login with User ID 'usr-super-admin'
  const resIdLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: 'usr-super-admin', password: 'Admin@123456' });
  assert.strictEqual(resIdLogin.status, 200, 'Login with User ID should return 200');
  assert.strictEqual(resIdLogin.body.success, true);
  assert.ok(resIdLogin.body.token, 'Should return JWT token');
  const adminToken = resIdLogin.body.token;
  console.log('✓ Login with User ID (usr-super-admin) succeeded');

  // 2. Test Login with alias 'admin'
  const resAliasLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: 'admin', password: 'Admin@123456' });
  assert.strictEqual(resAliasLogin.status, 200, 'Login with admin alias should return 200');
  console.log('✓ Login with User ID alias (admin) succeeded');

  // 3. Test Login with Email
  const resEmailLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: 'admin@centralcommand.io', password: 'Admin@123456' });
  assert.strictEqual(resEmailLogin.status, 200, 'Login with Email should return 200');
  console.log('✓ Login with Email (admin@centralcommand.io) succeeded');

  // 4. Test Invalid Password
  const resBadPass = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: 'admin', password: 'WrongPassword@999' });
  assert.strictEqual(resBadPass.status, 401, 'Invalid password should return 401');
  assert.strictEqual(resBadPass.body.success, false);
  console.log('✓ Rejection of invalid password verified');

  // 5. Test Non-existent User
  const resUnknown = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: 'non_existent_user_999', password: 'SomePassword@123' });
  assert.strictEqual(resUnknown.status, 401, 'Non-existent user should return 401');
  console.log('✓ Rejection of non-existent user verified');

  // 6. List users in DB
  const resUsers = await request(app)
    .get('/api/v1/auth/users')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.strictEqual(resUsers.status, 200);
  assert.ok(Array.isArray(resUsers.body.users));
  console.log(`✓ Fetched ${resUsers.body.users.length} registered database users`);

  // 7. Add a new user to DB
  const testUserId = 'test-operator-' + Date.now().toString(36);
  const testEmail = `${testUserId}@example.com`;
  const testPass = 'Secret123!';
  const resCreateUser = await request(app)
    .post('/api/v1/auth/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      id: testUserId,
      email: testEmail,
      fullName: 'Test Operator',
      role: 'OPERATIONS_MANAGER',
      password: testPass
    });
  assert.strictEqual(resCreateUser.status, 201, 'Create user should return 201');
  console.log(`✓ New user '${testUserId}' created directly in database`);

  // 8. Test logging in with newly created user's ID
  const resNewUserLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: testUserId, password: testPass });
  assert.strictEqual(resNewUserLogin.status, 200, 'New user login with User ID should return 200');
  assert.strictEqual(resNewUserLogin.body.user.id, testUserId);
  console.log(`✓ Successful login with newly created database user ID: ${testUserId}`);

  // 9. Delete test user
  const resDeleteUser = await request(app)
    .delete(`/api/v1/auth/users/${testUserId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.strictEqual(resDeleteUser.status, 200, 'Delete user should return 200');
  console.log(`✓ Deleted user '${testUserId}' from database`);

  // 10. Verify deleted user CANNOT log in anymore
  const resDeletedLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: testUserId, password: testPass });
  assert.strictEqual(resDeletedLogin.status, 401, 'Deleted user should be rejected with 401');
  console.log('✓ Login attempt by deleted user strictly rejected with 401');

  console.log('🎉 ALL DATABASE AUTHENTICATION & USER MANAGEMENT TESTS PASSED!');
}

if (require.main === module) {
  runAuthTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = runAuthTests;
