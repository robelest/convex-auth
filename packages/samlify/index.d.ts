export const Constants: any;
export const Utility: any;
export const SamlLib: any;

export function setSchemaValidator(validator: {
  validate: (xml: string) => Promise<string>;
}): void;

export function setFileIO(io: {
  readFile: (...args: any[]) => any;
}): void;

export function IdentityProvider(options: Record<string, unknown>): any;
export function ServiceProvider(options: Record<string, unknown>): any;
export function IdPMetadata(...args: any[]): any;
export function SPMetadata(...args: any[]): any;
