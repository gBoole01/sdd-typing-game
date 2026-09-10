/**
 * The trusted-proxy list as an injectable, rather than read from `ConfigService`
 * at the point of use.
 *
 * `ConfigModule.forRoot()` validates eagerly when `AppModule`'s metadata is
 * evaluated — once per module registry — so a second application built in the
 * same process inherits the first one's environment. This decision is what
 * `X-Client-Ip` is believed on (§ 8), and it has to be overridable per test
 * instance, exactly like `CLOCK`.
 */
export const TRUSTED_PROXY_CIDRS = Symbol('TRUSTED_PROXY_CIDRS');
