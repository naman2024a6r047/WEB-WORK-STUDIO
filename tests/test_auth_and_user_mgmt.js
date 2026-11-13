const assert = require('assert');
const authRouter = require('../src/routes/authRoutes');

function findRouteHandler(path, method) {
  const layer = authRouter.stack.find(s => s.route && s.route.path === path && s.route.methods[method.toLowerCase()]);
  if (!layer) throw new Error(`Route not found: ${method} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createMockRes() {
  return {
    statusCode: 200,
    bodyData: null,
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.bodyData = data;
      return this;
    }
  };
}

async function runAuthTests() {
  console.log('--- TEST SUITE 11: DATABASE-BACKED AUTHENTICATION & USER MANAGEMENT ---');

  const loginHandler = findRouteHandler('/login', 'post');
  const listUsersHandler = findRouteHandler('/users', 'get');
  const createUserHandler = findRouteHandler('/users', 'post');
  const deleteUserHandler = findRouteHandler('/users/:id', 'delete');

  const superAdminUser = { id: 'usr-super-admin', email: 'admin@centralcommand.io', role: 'SUPER_ADMIN' };

  // 1. Test Login with User ID 'usr-super-admin'
  const resIdRes = createMockRes();
  await loginHandler({ body: { identifier: 'usr-super-admin', password: 'Admin@123456' }, ip: '127.0.0.1' }, resIdRes);
  assert.strictEqual(resIdRes.statusCode, 200, 'Login with User ID should return 200');
  assert.strictEqual(resIdRes.bodyData.success, true);
  assert.ok(resIdRes.bodyData.token, 'Should return JWT token');
  console.log('✓ Login with User ID (usr-super-admin) succeeded');

  // 2. Test Login with alias 'admin'
  const resAliasRes = createMockRes();
  await loginHandler({ body: { identifier: 'admin', password: 'Admin@123456' }, ip: '127.0.0.1' }, resAliasRes);
  assert.strictEqual(resAliasRes.statusCode, 200, 'Login with admin alias should return 200');
  console.log('✓ Login with User ID alias (admin) succeeded');

  // 3. Test Login with Email
  const resEmailRes = createMockRes();
  await loginHandler({ body: { identifier: 'admin@centralcommand.io', password: 'Admin@123456' }, ip: '127.0.0.1' }, resEmailRes);
  assert.strictEqual(resEmailRes.statusCode, 200, 'Login with Email should return 200');
  console.log('✓ Login with Email (admin@centralcommand.io) succeeded');

  // 4. Test Invalid Password
  const resBadPass = createMockRes();
  await loginHandler({ body: { identifier: 'admin', password: 'WrongPassword@999' }, ip: '127.0.0.1' }, resBadPass);
  assert.strictEqual(resBadPass.statusCode, 401, 'Invalid password should return 401');
  assert.strictEqual(resBadPass.bodyData.success, false);
  console.log('✓ Rejection of invalid password verified');

  // 5. Test Non-existent User
  const resUnknown = createMockRes();
  await loginHandler({ body: { identifier: 'non_existent_user_999', password: 'SomePassword@123' }, ip: '127.0.0.1' }, resUnknown);
  assert.strictEqual(resUnknown.statusCode, 401, 'Non-existent user should return 401');
  console.log('✓ Rejection of non-existent user verified');

  // 6. List users in DB
  const resUsers = createMockRes();
  await listUsersHandler({ user: superAdminUser, ip: '127.0.0.1' }, resUsers);
  assert.strictEqual(resUsers.statusCode, 200);
  assert.ok(Array.isArray(resUsers.bodyData.users));
  console.log(`✓ Fetched ${resUsers.bodyData.users.length} registered database users`);

  // 7. Add a new user to DB
  const testUserId = 'test-operator-' + Date.now().toString(36);
  const testEmail = `${testUserId}@example.com`;
  const testPass = 'Secret123!';
  const resCreateUser = createMockRes();
  await createUserHandler({
    body: {
      id: testUserId,
      email: testEmail,
      fullName: 'Test Operator',
      role: 'OPERATIONS_MANAGER',
      password: testPass
    },
    user: superAdminUser,
    ip: '127.0.0.1'
  }, resCreateUser);
  assert.strictEqual(resCreateUser.statusCode, 201, 'Create user should return 201');
  console.log(`✓ New user '${testUserId}' created directly in database`);

  // 8. Test logging in with newly created user's ID
  const resNewUserLogin = createMockRes();
  await loginHandler({ body: { identifier: testUserId, password: testPass }, ip: '127.0.0.1' }, resNewUserLogin);
  assert.strictEqual(resNewUserLogin.statusCode, 200, 'New user login with User ID should return 200');
  assert.strictEqual(resNewUserLogin.bodyData.user.id, testUserId);
  console.log(`✓ Successful login with newly created database user ID: ${testUserId}`);

  // 9. Delete test user
  const resDeleteUser = createMockRes();
  await deleteUserHandler({ params: { id: testUserId }, user: superAdminUser, ip: '127.0.0.1' }, resDeleteUser);
  assert.strictEqual(resDeleteUser.statusCode, 200, 'Delete user should return 200');
  console.log(`✓ Deleted user '${testUserId}' from database`);

  // 10. Verify deleted user CANNOT log in anymore
  const resDeletedLogin = createMockRes();
  await loginHandler({ body: { identifier: testUserId, password: testPass }, ip: '127.0.0.1' }, resDeletedLogin);
  assert.strictEqual(resDeletedLogin.statusCode, 401, 'Deleted user should be rejected with 401');
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
