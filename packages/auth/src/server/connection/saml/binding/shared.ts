/**
 * Helpers and entity types shared by the redirect and POST binding builders.
 */
import { get } from "../encoding";
import type { BindingContext, SamlEntitySettings, SAMLDocumentTemplate } from "../types";
import type { IdentityProviderEntity as Idp } from "../identity/provider";
import type { ServiceProviderEntity as Sp } from "../service/provider";

/** Entity pair carried by login-request/response flows. */
export interface LoginEntity {
  idp: Idp;
  sp: Sp;
}

/** Entity pair carried by logout-request/response flows. */
export interface LogoutEntity {
  init: Idp | Sp;
  target: Idp | Sp;
}

/** {@link SamlEntitySettings} plus the logout-response template the binding reads but the base settings omit. */
export interface LogoutResponseSetting extends SamlEntitySettings {
  logoutResponseTemplate?: SAMLDocumentTemplate;
}

/**
 * `get` performs lodash-style traversal and returns `unknown`; a custom-tag
 * replacement yields a {@link BindingContext}, so `id`/`context` are strings.
 * The single boundary cast preserves `get`'s truthy-or-null runtime semantics.
 */
export function getBindingField(source: BindingContext, field: "id" | "context"): string {
  return get(source, field, null) as string;
}
