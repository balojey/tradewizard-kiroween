#!/usr/bin/env node
/**
 * Provision an admin account for the management portal.
 *
 * Creates the Cognito user if it does not exist, then adds it to an admin group.
 * Idempotent: re-running adds the group membership again (a no-op) and never
 * resets an existing password.
 *
 * Usage:
 *   npx tsx scripts/seed-admin.ts --email ops@tradewizard.live --group tw-owner \
 *     --user-pool-id us-east-1_XXXXXXXXX
 *
 * The pool id is exported by the Auth stack as `tw-{dev|prod}-user-pool-id`:
 *   aws cloudformation describe-stacks \
 *     --stack-name TradeWizard-Dev-Auth \
 *     --query "Stacks[0].Outputs[?ExportName=='tw-dev-user-pool-id'].OutputValue" \
 *     --output text
 *
 * After running this, the admin must complete TOTP enrolment (see the printed
 * instructions). ADMIN_REQUIRE_MFA=true in production rejects tokens from
 * accounts without a software token factor.
 *
 * See docs/admin-portal-architecture.md §6.
 */

import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

const VALID_GROUPS = ['tw-owner', 'tw-admin', 'tw-support', 'tw-analyst'] as const;
type AdminGroup = (typeof VALID_GROUPS)[number];

interface Args {
  email?: string;
  group?: string;
  userPoolId?: string;
  region?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--email':
        args.email = next;
        index += 1;
        break;
      case '--group':
        args.group = next;
        index += 1;
        break;
      case '--user-pool-id':
        args.userPoolId = next;
        index += 1;
        break;
      case '--region':
        args.region = next;
        index += 1;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        usage();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) {
          fail(`Unknown argument: ${arg}`);
        }
    }
  }

  return args;
}

function usage(): void {
  console.log(`
Provision a TradeWizard management-portal admin.

  --email <address>        Required. Admin's email (becomes their Cognito username)
  --group <group>          Required. One of: ${VALID_GROUPS.join(', ')}
  --user-pool-id <id>      Required unless USER_POOL_ID is set
  --region <region>        Defaults to AWS_REGION, then us-east-1
  --dry-run                Show what would happen without calling Cognito
`);
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function isAdminGroup(value: string): value is AdminGroup {
  return (VALID_GROUPS as readonly string[]).includes(value);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const email = args.email ?? process.env.ADMIN_EMAIL;
  const group = args.group;
  const userPoolId = args.userPoolId ?? process.env.USER_POOL_ID;
  const region = args.region ?? process.env.AWS_REGION ?? 'us-east-1';

  if (!email) fail('Missing --email');
  if (!group) fail('Missing --group');
  if (!isAdminGroup(group)) fail(`Invalid --group "${group}". Use one of: ${VALID_GROUPS.join(', ')}`);
  if (!userPoolId) fail('Missing --user-pool-id (or set USER_POOL_ID)');

  console.log(`\nAdmin seed → ${email} into ${group}`);
  console.log(`  pool:   ${userPoolId}`);
  console.log(`  region: ${region}`);

  if (args.dryRun) {
    console.log('\n--dry-run: no Cognito calls made.\n');
    return;
  }

  const client = new CognitoIdentityProviderClient({ region });

  // 1. Create the user when missing. Existing users are left untouched.
  let existed = true;
  try {
    await client.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }));
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name !== 'UserNotFoundException') throw error;
    existed = false;
  }

  if (!existed) {
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      })
    );
    console.log('✓ Created Cognito user (temporary password emailed)');
  } else {
    console.log('• User already exists — leaving credentials untouched');
  }

  // 2. Group membership (idempotent).
  await client.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: email,
      GroupName: group,
    })
  );
  console.log(`✓ Added to ${group}`);

  console.log(`
Next steps (full detail: docs/admin-portal-runbook.md §1):
  1. Set a permanent password:
       aws cognito-idp admin-set-user-password --user-pool-id ${userPoolId} \\
         --username ${email} --password '<chosen>' --permanent
  2. Enrol TOTP (§1.3). Verify it with:
       aws cognito-idp admin-get-user --user-pool-id ${userPoolId} \\
         --username ${email} --query "UserMFASettingList" --output json
     Expect ["SOFTWARE_TOKEN_MFA"]. Without it, ADMIN_REQUIRE_MFA=true denies
     this account.
  3. Sign in and check GET /admin/me returns linked:true (§1.4).
`);
}

main().catch((error) => {
  console.error('\n✗ Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
