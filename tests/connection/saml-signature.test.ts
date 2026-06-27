import {
  enforceGroupConnectionSamlSecurity,
  reconstructRedirectOctetString,
} from "@robelest/convex-auth/server/connection/saml";
import { verifySignature } from "@robelest/convex-auth/server/connection/saml/signature";
import { decryptAssertion } from "@robelest/convex-auth/server/connection/saml/xmlenc";
import { expect, test } from "vite-plus/test";

const NS = `xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"`;

test("verifySignature rejects a signature-wrapping (XSW) payload", async () => {
  const xsw = `<samlp:Response ${NS}>
    <saml:Assertion>
      <saml:Subject>
        <saml:SubjectConfirmation>
          <saml:SubjectConfirmationData>
            <saml:Assertion><saml:Issuer>attacker</saml:Issuer></saml:Assertion>
          </saml:SubjectConfirmationData>
        </saml:SubjectConfirmation>
      </saml:Subject>
    </saml:Assertion>
  </samlp:Response>`;
  await expect(verifySignature(xsw, {})).rejects.toThrow("ERR_POTENTIAL_WRAPPING_ATTACK");
});

test("verifySignature returns unverified for a response with no signature", async () => {
  const unsigned = `<samlp:Response ${NS}>
    <saml:Assertion><saml:Issuer>idp</saml:Issuer></saml:Assertion>
  </samlp:Response>`;
  const [verified, content] = await verifySignature(unsigned, {});
  expect(verified).toBe(false);
  expect(content).toBeNull();
});

test("SAML assertion without a validity window is rejected by default", () => {
  expect(() =>
    enforceGroupConnectionSamlSecurity({
      extract: { nameId: "user@example.com" } as never,
      config: {},
    }),
  ).toThrow("validity window");
});

test("SAML assertion with a SubjectConfirmationData NotOnOrAfter passes the requirement", () => {
  expect(() =>
    enforceGroupConnectionSamlSecurity({
      extract: { subjectConfirmation: { notOnOrAfter: "2999-01-01T00:00:00Z" } } as never,
      config: {},
    }),
  ).not.toThrow();
});

test("SAML assertion validity window can be opted out via security.requireTimestamps", () => {
  expect(() =>
    enforceGroupConnectionSamlSecurity({
      extract: { nameId: "user@example.com" } as never,
      config: { protocols: { saml: { security: { requireTimestamps: false } } } },
    }),
  ).not.toThrow();
});

test("encrypted-assertion decryption rejects unauthenticated AES-CBC", async () => {
  const cbc =
    `<saml:EncryptedAssertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">` +
    `<xenc:EncryptedData xmlns:xenc="http://www.w3.org/2001/04/xmlenc#">` +
    `<xenc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/>` +
    `<xenc:CipherData><xenc:CipherValue>AAAAAAAAAAAAAAAAAAAAAA==</xenc:CipherValue></xenc:CipherData>` +
    `</xenc:EncryptedData></saml:EncryptedAssertion>`;
  await expect(
    decryptAssertion({
      encryptedAssertionXml: cbc,
      privateKey: "-----BEGIN PRIVATE KEY-----\nMIIDUMMY\n-----END PRIVATE KEY-----",
    }),
  ).rejects.toThrow("ERR_UNSUPPORTED_DATA_ENCRYPTION_ALGORITHM");
});

test("redirect-binding octet string is rebuilt in canonical order with raw bytes", () => {
  const url = new URL(
    "https://sp.example/slo?SigAlg=http%3A%2F%2Fwww.w3.org%2F2001%2F04%2Fxmldsig-more%23rsa-sha256" +
      "&SAMLResponse=abc%2Bdef%2F&RelayState=relay%20state&Signature=ZZZ",
  );
  expect(reconstructRedirectOctetString(url)).toBe(
    "SAMLResponse=abc%2Bdef%2F&RelayState=relay%20state" +
      "&SigAlg=http%3A%2F%2Fwww.w3.org%2F2001%2F04%2Fxmldsig-more%23rsa-sha256",
  );
});

test("redirect-binding octet string omits an absent RelayState", () => {
  const url = new URL("https://sp.example/slo?SAMLRequest=req%2B1&SigAlg=alg&Signature=s");
  expect(reconstructRedirectOctetString(url)).toBe("SAMLRequest=req%2B1&SigAlg=alg");
});

test("redirect-binding octet string is undefined without a SAML message", () => {
  expect(reconstructRedirectOctetString(new URL("https://sp.example/slo?RelayState=x"))).toBe(
    undefined,
  );
});
