// version <= 1.25
import IdentityProvider, {
  IdentityProvider as IdentityProviderInstance,
} from "./entity-idp";
import ServiceProvider, {
  ServiceProvider as ServiceProviderInstance,
} from "./entity-sp";

export { default as IdPMetadata } from "./metadata-idp";
export { default as SPMetadata } from "./metadata-sp";
export { Utility, SamlLibCompat as SamlLib } from "./compat";
// roadmap
// new name convention in version >= 3.0
import * as Constants from "./urn";
import * as Extractor from "./core-xml";

// exposed methods for customizing samlify
import { setSchemaValidator, setDOMParserOptions, setFileIO } from "./core-xml";

export {
  Constants,
  Extractor,
  // temp: resolve the conflict after version >= 3.0
  IdentityProvider,
  IdentityProviderInstance,
  ServiceProvider,
  ServiceProviderInstance,
  // set context
  setSchemaValidator,
  setDOMParserOptions,
  setFileIO,
};
