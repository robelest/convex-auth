/**
 * SSRF host guard shared by the webhook-delivery path and the OIDC/SAML
 * metadata-fetch paths. Scheme- and hostname-level validation only — it does
 * not defend against DNS rebinding, where a public hostname resolves to a
 * private address at request time.
 *
 * @module
 */

type Ipv4Kind = "public" | "private" | "loopback" | "linkLocal";

function classifyIpv4(host: string): Ipv4Kind | null {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  const [a, b] = octets;
  if (a === 127 || a === 0) {
    return "loopback";
  }
  if (a === 169 && b === 254) {
    return "linkLocal";
  }
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) {
    return "private";
  }
  if (a === 192 && b === 168) {
    return "private";
  }
  return "public";
}

function ipv4KindFromMappedIpv6(inner: string): Ipv4Kind | null {
  if (inner.includes(".")) {
    return classifyIpv4(inner);
  }
  const hexGroups = inner.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hexGroups) {
    return null;
  }
  const high = parseInt(hexGroups[1], 16);
  const low = parseInt(hexGroups[2], 16);
  return classifyIpv4(`${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`);
}

type FetchUrlPolicy = {
  allowHttp: boolean;
  allowSingleLabelHosts: boolean;
};

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function unsafeHostValueReason(host: string): string | null {
  if (
    host.length === 0 ||
    host.trim() !== host ||
    hasAsciiControlCharacter(host) ||
    host.includes("/") ||
    host.includes("\\") ||
    host.includes("@") ||
    host.includes("://")
  ) {
    return "URL host must be a host value.";
  }
  let parsed: URL;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    return "URL host must be a host value.";
  }
  if (
    parsed.hostname.length === 0 ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return "URL host must be a host value.";
  }
  return null;
}

function unsafeHostReason(
  host: string,
  policy: Pick<FetchUrlPolicy, "allowSingleLabelHosts">,
): string | null {
  let hostname = host.toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  if (hostname.endsWith(".")) {
    hostname = hostname.slice(0, -1);
  }

  if (hostname.length === 0) {
    return "URL is missing a hostname.";
  }
  if (!policy.allowSingleLabelHosts && !hostname.includes(":") && !hostname.includes(".")) {
    return "URL host is not allowed (loopback, private, link-local, or internal target).";
  }

  const hardBlockedSuffix = hostname === "localhost" || hostname.endsWith(".localhost");
  if (hardBlockedSuffix) {
    return "URL host is not allowed (loopback, private, link-local, or internal target).";
  }

  const softBlockedSuffix = hostname.endsWith(".internal") || hostname.endsWith(".local");
  if (softBlockedSuffix) {
    return "URL host is not allowed (loopback, private, link-local, or internal target).";
  }

  const ipv4Kind = classifyIpv4(hostname);
  if (ipv4Kind === "loopback" || ipv4Kind === "linkLocal") {
    return "URL host is not allowed (loopback, private, link-local, or internal target).";
  }
  if (ipv4Kind === "private") {
    return "URL host is not allowed (loopback, private, link-local, or internal target).";
  }

  const normalized = hostname;
  if (normalized === "::1" || normalized === "::" || normalized === "::0") {
    return "URL host is not allowed (loopback, private, link-local, or internal target).";
  }
  const mapped = normalized.match(/^::ffff:(.+)$/);
  if (mapped) {
    const mappedKind = ipv4KindFromMappedIpv6(mapped[1]);
    if (mappedKind === "loopback" || mappedKind === "linkLocal") {
      return "URL host is not allowed (loopback, private, link-local, or internal target).";
    }
    if (mappedKind === "private") {
      return "URL host is not allowed (loopback, private, link-local, or internal target).";
    }
  }
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) {
    return "URL host is not allowed (loopback, private, link-local, or internal target).";
  }
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) {
    return "URL host is not allowed (loopback, private, link-local, or internal target).";
  }
  return null;
}

function unsafeFetchUrlReasonWithPolicy(url: string, policy: FetchUrlPolicy): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "URL is not a valid URL.";
  }

  if (parsed.protocol !== "https:" && !(policy.allowHttp && parsed.protocol === "http:")) {
    return policy.allowHttp
      ? "URL must use the http: or https: scheme."
      : "URL must use the https: scheme.";
  }

  return unsafeHostReason(parsed.hostname, policy);
}

/**
 * Reason an operator-supplied URL is rejected as an SSRF risk, or `null` when it
 * is safe to fetch server-side. Requires the `https:` scheme and rejects
 * hostnames that resolve to obviously internal targets: `localhost` and
 * `*.localhost`, `*.internal`, `*.local`, and IP literals in loopback/private/
 * link-local ranges (`127.0.0.0/8`, `0.0.0.0/8`, `10/8`, `172.16/12`,
 * `192.168/16`, `169.254/16` including the `169.254.169.254` cloud-metadata
 * address, `::1`, `fc00::/7`, `fe80::/10`, and `::ffff:`-mapped IPv4).
 *
 * Reasons begin with `"URL "` so callers can prefix a subject
 * (e.g. `` `Webhook ${reason}` ``).
 */
export function unsafeFetchUrlReason(url: string): string | null {
  return unsafeFetchUrlReasonWithPolicy(url, {
    allowHttp: false,
    allowSingleLabelHosts: false,
  });
}

/**
 * Reason an IdP discovery/metadata URL is rejected, or `null` when it is safe
 * to fetch server-side. IdP metadata may be served over `http:` by self-hosted
 * or Docker-local deployments, but obvious internal SSRF targets remain blocked
 * by default.
 */
export function unsafeIdpFetchUrlReason(url: string): string | null {
  return unsafeFetchUrlReasonWithPolicy(url, {
    allowHttp: true,
    allowSingleLabelHosts: true,
  });
}

/**
 * Throw when `url` is an unsafe IdP discovery/metadata fetch target.
 */
export function assertSafeIdpFetchUrl(url: string): void {
  const reason = unsafeIdpFetchUrlReason(url);
  if (reason !== null) {
    throw new Error(`Refusing to fetch ${reason}`);
  }
}

/**
 * Throw when `host` is unsafe to send as a proxy-mode IdP `Host` header. This is
 * a header-value check (reject header injection / malformed values), not an SSRF
 * target check: the Host header is metadata on a request whose actual target
 * (the rewritten URL) is guarded separately by {@link assertSafeIdpFetchUrl}, so
 * loopback/private host values (e.g. a self-hosted IdP issuer on `127.0.0.1`) are
 * allowed — blocking them adds no SSRF protection and breaks self-hosted IdPs.
 */
export function assertSafeIdpHost(host: string): void {
  const reason = unsafeHostValueReason(host);
  if (reason !== null) {
    throw new Error(`Refusing to fetch ${reason}`);
  }
}

/**
 * Throw when `url` is an unsafe public server-side fetch target.
 */
export function assertSafeFetchUrl(url: string): void {
  const reason = unsafeFetchUrlReason(url);
  if (reason !== null) {
    throw new Error(`Refusing to fetch ${reason}`);
  }
}
