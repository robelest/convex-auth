import { readFileSync } from "fs";
import path from "node:path";

import * as esaml2 from "@robelest/samlify";
import { extract } from "@robelest/samlify/src/extractor";
import { DOMParser as dom } from "@xmldom/xmldom";
import { test, expect } from "vite-plus/test";

process.chdir(path.resolve(import.meta.dirname, "../../packages/samlify"));

const FIXTURE_ROOT = path.resolve(import.meta.dirname);
const fixturePath = (relativePath: string) =>
  path.join(FIXTURE_ROOT, relativePath);
const fixtureRead = (relativePath: string) =>
  readFileSync(fixturePath(relativePath));

const parseUrlQueryObject = (value: string) =>
  Object.fromEntries(
    new URL(value, "https://example.com").searchParams.entries(),
  ) as Record<string, string>;

const {
  IdentityProvider: identityProvider,
  ServiceProvider: serviceProvider,
  IdPMetadata: _idpMetadata,
  SPMetadata: _spMetadata,
  Utility: utility,
  SamlLib: libsaml,
  Constants: ref,
} = esaml2;

const getQueryParamByType = libsaml.getQueryParamByType;
const wording = ref.wording;

test("#31 query param for sso/slo is SamlRequest", () => {
  expect(getQueryParamByType("SAMLRequest")).toBe(
    wording.urlParams.samlRequest,
  );
  expect(getQueryParamByType("LogoutRequest")).toBe(
    wording.urlParams.samlRequest,
  );
});
test("#31 query param for sso/slo is SamlResponse", () => {
  expect(getQueryParamByType("SAMLResponse")).toBe(
    wording.urlParams.samlResponse,
  );
  expect(getQueryParamByType("LogoutResponse")).toBe(
    wording.urlParams.samlResponse,
  );
});
test("#31 query param for sso/slo returns error", () => {
  expect(() => {
    getQueryParamByType("samlRequest");
  }).toThrow();
});

(() => {
  const spcfg = {
    entityID: "sp.example.com",
    nameIDFormat: ["urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"],
    assertionConsumerService: [
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
        Location: "sp.example.com/acs",
      },
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
        Location: "sp.example.com/acs",
      },
    ],
    singleLogoutService: [
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
        Location: "sp.example.com/slo",
      },
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
        Location: "sp.example.com/slo",
      },
    ],
  };
  const idpcfg = {
    entityID: "idp.example.com",
    nameIDFormat: ["urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"],
    singleSignOnService: [
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
        Location: "idp.example.com/sso",
      },
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
        Location: "idp.example.com/sso",
      },
    ],
    singleLogoutService: [
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
        Location: "idp.example.com/sso/slo",
      },
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
        Location: "idp.example.com/sso/slo",
      },
    ],
  };
  const idp = identityProvider(idpcfg);
  const sp = serviceProvider(spcfg);
  const spxml = sp.getMetadata();
  const idpxml = idp.getMetadata();
  const acs = extract(spxml, [
    {
      key: "assertionConsumerService",
      localPath: [
        "EntityDescriptor",
        "SPSSODescriptor",
        "AssertionConsumerService",
      ],
      attributes: ["Binding", "Location", "isDefault", "index"],
    },
  ]);
  const spslo = extract(spxml, [
    {
      key: "singleLogoutService",
      localPath: ["EntityDescriptor", "SPSSODescriptor", "SingleLogoutService"],
      attributes: ["Binding", "Location", "isDefault", "index"],
    },
  ]);
  const sso = extract(idpxml, [
    {
      key: "singleSignOnService",
      localPath: [
        "EntityDescriptor",
        "IDPSSODescriptor",
        "SingleSignOnService",
      ],
      attributes: ["Binding", "Location", "isDefault", "index"],
    },
  ]);
  const idpslo = extract(idpxml, [
    {
      key: "singleLogoutService",
      localPath: [
        "EntityDescriptor",
        "IDPSSODescriptor",
        "SingleLogoutService",
      ],
      attributes: ["Binding", "Location", "isDefault", "index"],
    },
  ]);
  const sp98 = serviceProvider({
    metadata: fixtureRead("misc/sp_metadata_98.xml"),
  });
  test("#33 sp metadata acs index should be increased by 1", () => {
    expect(acs.assertionConsumerService.length).toBe(2);
    expect(acs.assertionConsumerService[0].index).toBe("0");
    expect(acs.assertionConsumerService[1].index).toBe("1");
  });
  test("#352 no index attribute for sp SingleLogoutService nodes", () => {
    expect(spslo.singleLogoutService.length).toBe(2);
    expect(spslo.singleLogoutService[0].index).toBe(undefined);
    expect(spslo.singleLogoutService[1].index).toBe(undefined);
  });
  test("#352 no index attribute for idp SingleSignOnService nodes", () => {
    expect(sso.singleSignOnService.length).toBe(2);
    expect(sso.singleSignOnService[0].index).toBe(undefined);
    expect(sso.singleSignOnService[1].index).toBe(undefined);
  });
  test("#352 no index attribute for idp SingleLogoutService nodes", () => {
    expect(idpslo.singleLogoutService.length).toBe(2);
    expect(idpslo.singleLogoutService[0].index).toBe(undefined);
    expect(idpslo.singleLogoutService[1].index).toBe(undefined);
  });
  test("#86 duplicate issuer throws error", () => {
    const xml = fixtureRead("misc/dumpes_issuer_response.xml");
    const { issuer } = extract(xml.toString(), [
      {
        key: "issuer",
        localPath: [
          ["Response", "Issuer"],
          ["Response", "Assertion", "Issuer"],
        ],
        attributes: [],
      },
    ]);
    expect(issuer.length).toBe(1);
    expect(
      issuer.every((i: string) => i === "http://www.okta.com/dummyIssuer"),
    ).toBe(true);
  });

  test("#87 add existence check for signature verification", () => {
    const res = libsaml.verifySignature(
      fixtureRead("misc/response.xml").toString(),
      {},
    );
    expect(res[0]).toBe(false); // signature is invalid because one doesn't exist
  });

  test("#91 idp gets single sign on service from the metadata", () => {
    expect(idp.entityMeta.getSingleSignOnService("post")).toBe(
      "idp.example.com/sso",
    );
  });

  test("#98 undefined AssertionConsumerServiceURL with redirect request", () => {
    const { context } = sp98.createLoginRequest(idp, "redirect");
    const query = parseUrlQueryObject(context);
    const request = query.SAMLRequest;
    const rawRequest = utility.inflateString(decodeURIComponent(request));
    const xml = new dom().parseFromString(rawRequest);
    const acsUrl = xml.documentElement.attributes.getNamedItem(
      "AssertionConsumerServiceURL",
    )?.value;
    expect(acsUrl).toBe("https://example.org/response");
  });
})();
