/**
 * Clean, focused modal dialog for connecting an external PostgreSQL database.
 */

import { useState } from "react";
import { LoadingSpinner } from "../../components/ui/loading_spinner";
import { getUserFriendlyErrorMessage } from "../../services/margin_http_client";
import type { DatabaseConnectionTestResponse } from "../../types/api_contract_types";
import {
  useCreateDatabaseConnectionMutation,
  useTestDatabaseConnectionMutation,
} from "./use_sql_queries";

interface ConnectDatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: (connectionId: string) => void;
}

export function ConnectDatabaseModal({
  isOpen,
  onClose,
  onConnected,
}: ConnectDatabaseModalProps) {
  const [displayName, setDisplayName] = useState("");
  const [connectionUrl, setConnectionUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Advanced fields (host, port, dbName, user, password)
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5432");
  const [dbName, setDbName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sslMode, setSslMode] = useState("require");
  const [showPassword, setShowPassword] = useState(false);

  // Status & error states
  const [testResult, setTestResult] = useState<DatabaseConnectionTestResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const testMutation = useTestDatabaseConnectionMutation();
  const createMutation = useCreateDatabaseConnectionMutation();

  if (!isOpen) return null;

  const resolveConnectionUrl = (): string => {
    if (!showAdvanced) {
      return connectionUrl.trim();
    }
    const cleanHost = host.trim();
    const cleanPort = port.trim() || "5432";
    const cleanDb = dbName.trim();
    const cleanUser = encodeURIComponent(username.trim());
    const cleanPass = encodeURIComponent(password.trim());
    const sslParam = sslMode ? `?sslmode=${sslMode}` : "";
    return `postgresql://${cleanUser}:${cleanPass}@${cleanHost}:${cleanPort}/${cleanDb}${sslParam}`;
  };

  const handleTest = async () => {
    const url = resolveConnectionUrl();
    if (!url) {
      setTestError("Please enter a PostgreSQL connection URL.");
      return;
    }
    setTestError(null);
    setTestResult(null);

    try {
      const res = await testMutation.mutateAsync({
        provider: "postgresql",
        connection_url: url,
      });
      setTestResult(res);
    } catch (err) {
      setTestError(
        getUserFriendlyErrorMessage(
          err,
          "Could not connect to database. Please check your host and credentials.",
        ),
      );
    }
  };

  const handleConnect = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const url = resolveConnectionUrl();
    if (!displayName.trim()) {
      setCreateError("Please enter a connection name (e.g. Sales Database).");
      return;
    }
    if (!url) {
      setCreateError("Please enter a PostgreSQL connection URL.");
      return;
    }
    setCreateError(null);

    try {
      const res = await createMutation.mutateAsync({
        display_name: displayName.trim(),
        provider: "postgresql",
        connection_url: url,
      });
      onConnected?.(res.id);
      onClose();
    } catch (err) {
      setCreateError(
        getUserFriendlyErrorMessage(
          err,
          "Failed to save connection. Please check that credentials are valid.",
        ),
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-db-title"
    >
      <div className="w-full max-w-[620px] bg-surface-container-lowest border border-outline-variant/40 rounded-2xl shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 flex items-start justify-between border-b border-surface-container-high bg-surface-container-lowest">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 shadow-2xs">
              <span className="material-symbols-outlined text-2xl">database</span>
            </div>
            <div>
              <h2
                id="connect-db-title"
                className="font-headline-sm text-lg font-bold text-on-surface"
              >
                Connect a Database
              </h2>
              <p className="font-body-dense text-xs text-on-surface-variant">
                Ask questions about your PostgreSQL data using natural language.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="text-on-surface-variant hover:text-on-surface p-1.5 rounded-lg hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scroll bg-surface">
          <form onSubmit={handleConnect} autoComplete="off" className="space-y-4">
            {/* Decoy fields to absorb aggressive browser credential autofill */}
            <input type="text" name="chrome_autofill_decoy_user" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" autoComplete="off" />
            <input type="password" name="chrome_autofill_decoy_pass" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" autoComplete="new-password" />

            {/* Connection Name */}
            <div className="space-y-1">
              <label
                htmlFor="db-name-input"
                className="block font-label-md text-xs font-semibold text-on-surface"
              >
                Connection Name
              </label>
              <input
                id="db-name-input"
                name="db_display_name"
                type="text"
                autoComplete="off"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Sales Database"
                className="w-full bg-surface-container-lowest border border-outline-variant/50 rounded-xl px-3.5 py-2.5 font-body-default text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                required
              />
            </div>

            {/* Database Provider */}
            <div className="space-y-1">
              <span className="block font-label-md text-xs font-semibold text-on-surface">
                Database Provider
              </span>
              <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs">
                <div className="flex items-center gap-2 text-on-surface font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>PostgreSQL</span>
                </div>
                <span className="font-code-sm text-[11px] text-on-surface-variant">
                  Read-only enforced
                </span>
              </div>
            </div>

            {/* Connection URL or Advanced Fields */}
            {!showAdvanced ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="db-url-input"
                    className="block font-label-md text-xs font-semibold text-on-surface"
                  >
                    Connection URL
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(true)}
                    className="font-label-sm text-[11px] text-primary hover:underline"
                  >
                    Enter host &amp; credentials separately
                  </button>
                </div>
                <input
                  id="db-url-input"
                  name="db_connection_url"
                  aria-label="Connection URL"
                  type="text"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  value={connectionUrl}
                  onChange={(e) => {
                    setConnectionUrl(e.target.value);
                    setTestResult(null);
                    setTestError(null);
                  }}
                  placeholder="postgresql://username:password@hostname:5432/database_name"
                  className="w-full font-code-sm text-xs bg-surface-container-lowest border border-outline-variant/50 rounded-xl px-3.5 py-2.5 text-on-surface font-mono placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  required
                />
              </div>
            ) : (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between pb-1 border-b border-surface-container-high">
                  <span className="font-label-sm text-xs font-semibold text-on-surface">
                    Host &amp; Credentials
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(false)}
                    className="font-label-sm text-[11px] text-primary hover:underline"
                  >
                    Paste connection URL instead
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div className="col-span-2 space-y-1">
                    <label htmlFor="adv-host" className="block text-[11px] font-medium text-on-surface">
                      Host
                    </label>
                    <input
                      id="adv-host"
                      name="db_host"
                      type="text"
                      autoComplete="off"
                      placeholder="e.g. ep-xyz.neon.tech"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      className="w-full font-code-sm text-xs bg-surface-container-lowest border border-outline-variant/50 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="adv-port" className="block text-[11px] font-medium text-on-surface">
                      Port
                    </label>
                    <input
                      id="adv-port"
                      name="db_port"
                      type="text"
                      autoComplete="off"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      className="w-full font-code-sm text-xs bg-surface-container-lowest border border-outline-variant/50 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label htmlFor="adv-db" className="block text-[11px] font-medium text-on-surface">
                      Database
                    </label>
                    <input
                      id="adv-db"
                      name="db_name"
                      type="text"
                      autoComplete="off"
                      placeholder="e.g. sales"
                      value={dbName}
                      onChange={(e) => setDbName(e.target.value)}
                      className="w-full font-code-sm text-xs bg-surface-container-lowest border border-outline-variant/50 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="adv-user" className="block text-[11px] font-medium text-on-surface">
                      Database User
                    </label>
                    <input
                      id="adv-user"
                      name="db_role_user"
                      type="text"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      placeholder="e.g. reader"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full font-code-sm text-xs bg-surface-container-lowest border border-outline-variant/50 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label htmlFor="adv-pass" className="block text-[11px] font-medium text-on-surface">
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="adv-pass"
                        name="db_secret_key"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full font-code-sm text-xs bg-surface-container-lowest border border-outline-variant/50 rounded-lg pl-3 pr-8 py-2 text-on-surface focus:outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((p) => !p)}
                        className="absolute right-2 top-2 text-outline hover:text-on-surface"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {showPassword ? "visibility_off" : "visibility"}
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="adv-ssl" className="block text-[11px] font-medium text-on-surface">
                      SSL Mode
                    </label>
                    <select
                      id="adv-ssl"
                      value={sslMode}
                      onChange={(e) => setSslMode(e.target.value)}
                      className="w-full bg-surface-container-lowest border border-outline-variant/50 rounded-lg px-3 py-2 text-xs text-on-surface focus:outline-none focus:border-primary"
                    >
                      <option value="require">Require (Recommended)</option>
                      <option value="verify-full">Verify Full</option>
                      <option value="prefer">Prefer</option>
                      <option value="disable">Disable</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </form>

          {/* Simple Security Notice */}
          <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/20 flex items-center gap-2.5 text-xs text-on-surface-variant">
            <span className="material-symbols-outlined text-primary text-lg shrink-0">lock</span>
            <p>
              Your credentials are encrypted and never sent to the AI model. Read-only queries are strictly enforced.
            </p>
          </div>

          {/* Test Result Banner */}
          {testResult && (
            <div className="rounded-xl px-3.5 py-2.5 bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-300 animate-in fade-in duration-150">
              <div className="flex items-center gap-2 font-medium">
                <span className="material-symbols-outlined text-base">check_circle</span>
                <span>Connection test successful</span>
              </div>
              <span className="font-code-sm text-[11px]">
                {testResult.table_count} {testResult.table_count === 1 ? "table" : "tables"} discovered
              </span>
            </div>
          )}

          {/* Error Banner */}
          {(testError || createError) && (
            <div className="rounded-xl px-3.5 py-2.5 bg-rose-500/10 border border-rose-500/30 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300 animate-in fade-in duration-150">
              <span className="material-symbols-outlined text-base text-rose-600">error</span>
              <p>{testError || createError}</p>
            </div>
          )}
        </div>

        {/* Footer Actions (Consistent h-10 button sizes and alignment) */}
        <div className="px-6 py-4 bg-surface-container-lowest border-t border-surface-container-high flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-xl border border-outline-variant/50 text-on-surface hover:bg-surface-container-low text-xs font-semibold transition-colors whitespace-nowrap"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleTest}
              disabled={testMutation.isPending}
              className="h-10 px-4 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface border border-outline-variant/40 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {testMutation.isPending ? (
                <>
                  <LoadingSpinner size="xs" ariaLabel="Verifying connection" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-base text-primary">sync</span>
                  <span>Test Connection</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleConnect()}
              disabled={createMutation.isPending}
              className="h-10 px-5 rounded-xl bg-primary hover:bg-primary/95 text-on-primary text-xs font-bold inline-flex items-center gap-1.5 transition-all shadow-xs whitespace-nowrap disabled:opacity-50 active:scale-98"
            >
              {createMutation.isPending ? (
                <>
                  <LoadingSpinner size="xs" variant="onPrimary" ariaLabel="Connecting database" />
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-base">link</span>
                  <span>Connect Database</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
