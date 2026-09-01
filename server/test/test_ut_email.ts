/**
 * The UT email allow-list (LOOP-255) — who can be sent a verification code.
 *
 * This is an access-control boundary, not a formatting nicety: the code is the
 * only way into the app, so this function decides who gets in. The cases below
 * are the ones that make a domain check wrong in practice, and each is here
 * because writing the check the obvious way gets it wrong.
 */

import { describe, expect, it } from 'vitest';
import {
  ALLOWED_UT_DOMAINS,
  APP_REVIEW_EMAIL,
  isAllowedUTEmail,
  normalizeUTEmail,
} from '../../shared/utEmail';

describe('isAllowedUTEmail — accepts', () => {
  it('the three allowed domains', () => {
    expect(isAllowedUTEmail('mwalker@utexas.edu')).toBe(true);
    expect(isAllowedUTEmail('mwalker@my.utexas.edu')).toBe(true);
    expect(isAllowedUTEmail('tv6269@eid.utexas.edu')).toBe(true);
  });

  it('the App Review bypass address, and only that exact address', () => {
    // Guideline 2.1(a), build 4: Apple's reviewer has no UT email. This one
    // non-UT address is let through the domain gate on purpose — see
    // APP_REVIEW_EMAIL's doc comment and issueVerificationCode in
    // auth.worker.ts for how it still can't sign in without the
    // APP_REVIEW_CODE secret.
    expect(isAllowedUTEmail(APP_REVIEW_EMAIL)).toBe(true);
    expect(isAllowedUTEmail(' AppReview@LonghornDevelopers.ORG ')).toBe(true);
    expect(isAllowedUTEmail('appreview@longhorndevelopers.org.attacker.com')).toBe(false);
    expect(isAllowedUTEmail('notappreview@longhorndevelopers.org')).toBe(false);
  });

  it('any case and surrounding whitespace', () => {
    expect(isAllowedUTEmail('  MWalker@UTEXAS.EDU  ')).toBe(true);
    expect(isAllowedUTEmail('MWALKER@MY.UTEXAS.EDU')).toBe(true);
  });

  it('the local-part shapes UT actually issues', () => {
    expect(isAllowedUTEmail('m.walker2@utexas.edu')).toBe(true);
    expect(isAllowedUTEmail('mw27422+loop@utexas.edu')).toBe(true);
    expect(isAllowedUTEmail('tv6269@utexas.edu')).toBe(true);
  });
});

describe('isAllowedUTEmail — rejects', () => {
  it('non-UT domains', () => {
    expect(isAllowedUTEmail('someone@gmail.com')).toBe(false);
    expect(isAllowedUTEmail('someone@utexas.com')).toBe(false);
  });

  it('LOOK-ALIKE domains — the reason this is not endsWith()', () => {
    // `endsWith('utexas.edu')` accepts every one of these. They are registrable
    // by anyone, so a suffix check hands the app to whoever buys one.
    expect(isAllowedUTEmail('attacker@evil-utexas.edu')).toBe(false);
    expect(isAllowedUTEmail('attacker@notutexas.edu')).toBe(false);
    expect(isAllowedUTEmail('attacker@utexas.edu.attacker.com')).toBe(false);
    expect(isAllowedUTEmail('attacker@my-utexas.edu')).toBe(false);
  });

  it('UT subdomains outside the list — the deliberate lockout', () => {
    // Departmental, staff and alumni subdomains are still out. If beta
    // produces lockout reports, widen ALLOWED_UT_DOMAINS and flip these.
    expect(isAllowedUTEmail('someone@austin.utexas.edu')).toBe(false);
    expect(isAllowedUTEmail('someone@cs.utexas.edu')).toBe(false);
    expect(isAllowedUTEmail('someone@alumni.utexas.edu')).toBe(false);
  });

  it('addresses that could smuggle a second recipient', () => {
    // If anything downstream ever splits a header on comma or semicolon, these
    // become two deliveries. Cheaper to refuse than to audit every consumer.
    expect(isAllowedUTEmail('a@utexas.edu,b@evil.com')).toBe(false);
    expect(isAllowedUTEmail('a@utexas.edu;b@evil.com')).toBe(false);
    expect(isAllowedUTEmail('Name <a@utexas.edu>')).toBe(false);
    expect(isAllowedUTEmail('a b@utexas.edu')).toBe(false);
    expect(isAllowedUTEmail('a@utexas.edu\nbcc: b@evil.com')).toBe(false);
  });

  it('malformed local parts', () => {
    expect(isAllowedUTEmail('@utexas.edu')).toBe(false);
    expect(isAllowedUTEmail('.a@utexas.edu')).toBe(false);
    expect(isAllowedUTEmail('a.@utexas.edu')).toBe(false);
    expect(isAllowedUTEmail('a..b@utexas.edu')).toBe(false);
  });

  it('anything with the wrong number of @', () => {
    expect(isAllowedUTEmail('utexas.edu')).toBe(false);
    expect(isAllowedUTEmail('a@b@utexas.edu')).toBe(false);
    expect(isAllowedUTEmail('a@')).toBe(false);
  });

  it('non-strings and empty input, without throwing', () => {
    expect(isAllowedUTEmail('')).toBe(false);
    expect(isAllowedUTEmail('   ')).toBe(false);
    expect(isAllowedUTEmail(null)).toBe(false);
    expect(isAllowedUTEmail(undefined)).toBe(false);
    expect(isAllowedUTEmail(42)).toBe(false);
    expect(isAllowedUTEmail({ email: 'a@utexas.edu' })).toBe(false);
  });
});

describe('normalizeUTEmail', () => {
  it('trims and lowercases so the stored key is stable', () => {
    // users.email is the account key and verification_codes.email is its
    // primary key — two casings of one address would be two accounts.
    expect(normalizeUTEmail('  MWalker@UTexas.EDU ')).toBe('mwalker@utexas.edu');
  });
});

describe('ALLOWED_UT_DOMAINS', () => {
  it('is exactly the three domains that were signed off', () => {
    // A guard against someone widening the gate without meaning to. If this
    // fails, the change was either deliberate — update it — or an accident.
    expect([...ALLOWED_UT_DOMAINS]).toEqual(['utexas.edu', 'my.utexas.edu', 'eid.utexas.edu']);
  });
});
