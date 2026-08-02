# Verified-contact account binding

## Scope

CR2C consumes a confirmed CR2B ticket during an account mutation. It adds backend support for:

- creating an account with one verified email or phone;
- attaching a verified contact to an authenticated account;
- resetting a password through an already attached verified contact;
- listing masked contacts for the authenticated account.

It does not add passwordless login. The ordinary username/password and recovery-code routes remain independent and unchanged.

## Storage

`verified_contacts` stores:

- a random contact ID;
- owning user ID;
- channel (`email` or `sms`);
- HMAC destination digest;
- masked destination;
- verification timestamp;
- source challenge ID and lifecycle timestamps.

The table enforces:

- one owner for each channel/destination digest;
- at most one verified contact of each channel per account;
- cascade deletion when the account is deleted.

No raw email address or phone number is persisted.

`contact_ticket_consumptions` records the challenge, user, channel, purpose, digest and consumption time. Its non-null primary key makes replay durable even if an old challenge row is later pruned.

## Transaction guard

The receipt statement selects its challenge ID only when the matching challenge:

- was delivered by the provider;
- was confirmed;
- has not already been consumed;
- matches the signed channel, purpose and digest;
- is still inside the ten-minute ticket lifetime.

When any condition fails, the scalar subquery produces `NULL`; the non-null receipt primary key rejects the statement. A repeated ticket instead fails the same primary key's uniqueness constraint.

Receipt creation, the explicit challenge `consumed_at` update and the account/contact mutation execute in one D1 batch. D1 treats the batch as a transaction and rolls back the full sequence when any statement fails. Therefore duplicate ownership or another account mutation error does not burn the ticket, while successful use leaves both a durable receipt and consumed challenge state.

This triggerless design is compatible with remote Wrangler migrations and preserves the same database-enforced expiry/replay boundary.

## API

All routes return `X-Contact-Account-Contract: contact-account-v1` and remain hidden with `404` when neither verified-contact channel is fully configured.

### Register with a verified contact

`POST /api/auth/contact/register`

```json
{
  "username": "sql_engineer",
  "password": "a long account password",
  "displayName": "SQL Engineer",
  "deviceName": "ПК · Windows",
  "contactTicket": "<signed register ticket>"
}
```

The transaction creates the user, profile, eight recovery codes, initial session, contact ownership and consumption receipt. Any failure rolls back the entire registration.

The response follows the ordinary registration contract and additionally includes the newly bound masked contact.

### Attach a contact

`POST /api/auth/contact/attach`

Requires the current bearer session.

```json
{
  "currentPassword": "current account password",
  "contactTicket": "<signed sensitive-action ticket>"
}
```

The current password is rechecked before the contact can be attached. An account may own one email and one phone. A destination already owned by another account is rejected.

### List contacts

`GET /api/auth/contacts`

Requires the current bearer session. Only IDs, channels, masked destinations and timestamps are returned.

### Reset password through a contact

`POST /api/auth/contact/password/reset`

```json
{
  "contactTicket": "<signed password-reset ticket>",
  "newPassword": "a different long password"
}
```

The ticket digest resolves the owner through `verified_contacts`; no username or raw contact is submitted to this route. Successful reset consumes the ticket, changes the password, clears login lock state and deletes every active session in one transaction.

## Turnstile

When Turnstile is enabled, public contact registration and contact password reset require exact actions:

- `contact-register`;
- `contact-password-reset`.

Challenge delivery already uses `contact-challenge`. Authenticated contact attachment is not a public Turnstile action because it requires a valid session, the current password and a confirmed `sensitive-action` ticket.

## Failure and privacy contracts

- invalid, expired, wrong-purpose and replayed tickets fail without changing account state;
- duplicate contact ownership fails without consuming the ticket;
- raw destinations, codes, tickets, passwords and provider secrets are never logged;
- account deletion cascades through verified contacts and consumption receipts;
- feature flags alone cannot expose an incomplete channel;
- the current Cloudflare Free deployment keeps every verified-contact route hidden.

## Remaining product work

Before buyer activation:

1. add capability-gated learner UI for challenge, confirmation and account actions;
2. integrate the buyer's Turnstile site key and provider UX;
3. test real delivery, bounce, timeout and abuse behavior in staging;
4. add support and recovery runbooks;
5. perform independent security and privacy review;
6. retain recovery codes as a separate fallback unless the buyer explicitly changes that policy.
