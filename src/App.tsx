import { useEffect, useState } from "react";
import {
  clearEpicAuthSession,
  createPatientNote,
  createTeleEncounter,
  exchangeEpicToken,
  getEpicAuthSession,
  getWorkflowData,
  saveEpicAuthSession,
  type EpicAuthSession,
} from "./epicAuth";
import "./App.css";

type AuthState =
  | { kind: "loading" }
  | { kind: "ready"; session: EpicAuthSession }
  | { kind: "error"; message: string }
  | { kind: "idle" };

type FhirCodeableConcept = {
  text?: string;
  coding?: Array<{ display?: string }>;
};

type WorkflowData = {
  patient?: {
    id?: string;
    name?: Array<{ given?: string[]; family?: string }>;
    birthDate?: string;
    gender?: string;
    telecom?: Array<{ system?: string; value?: string; use?: string }>;
    address?: Array<{
      line?: string[];
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
    }>;
  };
  encounters?: Encounter[];
  singleEncounter?: Encounter;
  diagnostics?: DiagnosticReport[];
  diagnosticReports?: DiagnosticReport[];
  documents?: DocumentReference[];
};

type Encounter = {
  id?: string;
  status?: string;
  class?: { code?: string; display?: string };
  type?: FhirCodeableConcept[];
  period?: { start?: string; end?: string };
};

type DiagnosticReport = {
  id?: string;
  status?: string;
  category?: FhirCodeableConcept[];
  code?: FhirCodeableConcept;
  effectiveDateTime?: string;
  issued?: string;
  result?: Array<{ display?: string }>;
};

type DocumentReference = {
  id?: string;
  status?: string;
  docStatus?: string;
  type?: FhirCodeableConcept;
  date?: string;
  content?: Array<{
    attachment?: { contentType?: string; data?: string; title?: string };
  }>;
};

function formatPatientName(patient: WorkflowData["patient"]) {
  const name = patient?.name?.[0];
  return (
    [name?.given?.join(" "), name?.family].filter(Boolean).join(" ") ||
    "Unknown patient"
  );
}

function formatEncounterType(encounter: Encounter) {
  const type = encounter.type?.[0];
  return type?.text || type?.coding?.[0]?.display || "Clinical encounter";
}

function formatDate(date?: string) {
  if (!date) return "Date unavailable";
  const value = new Date(date);
  return Number.isNaN(value.valueOf())
    ? date
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value);
}

function formatDateTime(date?: string) {
  if (!date) return "Not available";
  const value = new Date(date);
  return Number.isNaN(value.valueOf())
    ? date
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(value);
}

function formatDiagnosticName(report: DiagnosticReport) {
  return (
    report.code?.text ||
    report.code?.coding?.[0]?.display ||
    "Diagnostic report"
  );
}

function formatDiagnosticCategory(report: DiagnosticReport) {
  return (
    report.category?.[0]?.text || report.category?.[0]?.coding?.[0]?.display
  );
}

function formatDocumentTitle(document: DocumentReference) {
  return (
    document.type?.text ||
    document.type?.coding?.[0]?.display ||
    "Clinical document"
  );
}

function decodeDocumentText(data?: string) {
  if (!data) return null;
  try {
    const bytes = Uint8Array.from(atob(data), (character) =>
      character.charCodeAt(0),
    );
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function getInitialAuthState(): AuthState {
  const params = new URLSearchParams(window.location.search);
  const hasSuccessfulLaunch =
    params.get("success") === "true" &&
    Boolean(params.get("token_id")) &&
    Boolean(params.get("connectionId"));

  if (hasSuccessfulLaunch) return { kind: "loading" };

  const session = getEpicAuthSession();
  return session ? { kind: "ready", session } : { kind: "idle" };
}

function App() {
  const [authState, setAuthState] = useState<AuthState>(getInitialAuthState);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [dataStatus, setDataStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [workflowData, setWorkflowData] = useState<WorkflowData | null>(null);
  const [isNoteDialogOpen, setIsNoteDialogOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteStatus, setNoteStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [isTeleEncounterDialogOpen, setIsTeleEncounterDialogOpen] =
    useState(false);
  const [teleEncounterStart, setTeleEncounterStart] = useState("");
  const [teleEncounterEnd, setTeleEncounterEnd] = useState("");
  const [teleEncounterStatus, setTeleEncounterStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const diagnosticReports =
    workflowData?.diagnostics ?? workflowData?.diagnosticReports ?? [];
  const documents = workflowData?.documents ?? [];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenId = params.get("token_id");
    const connectionId = params.get("connectionId");
    const patientId = params.get("patient");
    const encounterId = params.get("encounter");
    const workflowId = params.get("workflowId");
    const isSuccessfulLaunch = params.get("success") === "true";

    if (!isSuccessfulLaunch || !tokenId || !connectionId) return;

    let cancelled = false;

    void exchangeEpicToken(connectionId, tokenId)
      .then((session) => {
        if (cancelled) return;
        const launchSession = {
          ...session,
          launchPatientId: patientId || undefined,
          launchEncounterId: encounterId || undefined,
          workflowId: workflowId || undefined,
        };
        saveEpicAuthSession(launchSession);
        setAuthState({ kind: "ready", session: launchSession });

        // A token_id is one-time and should not remain in history or shared URLs.
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname,
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAuthState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Epic token exchange failed.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function disconnect() {
    clearEpicAuthSession();
    setCopyStatus("idle");
    setDataStatus("idle");
    setWorkflowData(null);
    setIsNoteDialogOpen(false);
    setNoteText("");
    setNoteStatus("idle");
    setIsTeleEncounterDialogOpen(false);
    setTeleEncounterStart("");
    setTeleEncounterEnd("");
    setTeleEncounterStatus("idle");
    setAuthState({ kind: "idle" });
  }

  // async function copyAccessToken(accessToken: string) {
  //   try {
  //     await navigator.clipboard.writeText(accessToken);
  //     setCopyStatus("copied");
  //   } catch {
  //     setCopyStatus("error");
  //   }
  // }

  async function fetchData(session: EpicAuthSession) {
    setWorkflowData(null);
    const patientId = session.launchPatientId || session.patient;
    if (!patientId) {
      setDataStatus("error");
      return;
    }

    setDataStatus("loading");
    try {
      const data = await getWorkflowData(
        patientId,
        session.accessToken,
        session.launchEncounterId || session.encounter,
        session.workflowId,
      );
      setWorkflowData(data as WorkflowData);
      setDataStatus("success");
    } catch {
      setDataStatus("error");
    }
  }

  function openNoteDialog() {
    setNoteStatus("idle");
    setIsNoteDialogOpen(true);
  }

  function closeNoteDialog() {
    if (noteStatus === "saving") return;
    setIsNoteDialogOpen(false);
    setNoteText("");
    setNoteStatus("idle");
  }

  async function submitNote(session: EpicAuthSession) {
    const patientId = session.launchPatientId || session.patient;
    if (!patientId || !noteText.trim()) {
      setNoteStatus("error");
      return;
    }

    setNoteStatus("saving");
    try {
      await createPatientNote(
        patientId,
        session.accessToken,
        noteText.trim(),
        session.launchEncounterId || session.encounter,
        session.workflowId,
      );
      setNoteStatus("success");
      setTimeout(() => {
        fetchData(session);
      }, 1000);
      setNoteText("");
    } catch {
      setNoteStatus("error");
    }
  }

  function openTeleEncounterDialog() {
    setTeleEncounterStatus("idle");
    setIsTeleEncounterDialogOpen(true);
  }

  function closeTeleEncounterDialog() {
    if (teleEncounterStatus === "saving") return;
    setIsTeleEncounterDialogOpen(false);
    setTeleEncounterStart("");
    setTeleEncounterEnd("");
    setTeleEncounterStatus("idle");
  }

  async function submitTeleEncounter(session: EpicAuthSession) {
    const patientId = session.launchPatientId || session.patient;
    if (
      !patientId ||
      !teleEncounterStart ||
      !teleEncounterEnd ||
      teleEncounterEnd <= teleEncounterStart
    ) {
      setTeleEncounterStatus("error");
      return;
    }

    setTeleEncounterStatus("saving");
    try {
      await createTeleEncounter(
        patientId,
        session.accessToken,
        teleEncounterStart,
        teleEncounterEnd,
        session.launchEncounterId || session.encounter,
        session.workflowId,
      );
      setTeleEncounterStatus("success");
      setTimeout(() => {
        fetchData(session);
      }, 1000);
    } catch {
      setTeleEncounterStatus("error");
    }
  }

  return (
    <main className="auth-page">
      <section
        className="auth-card"
        aria-live="polite"
      >
        <p className="eyebrow">Epic SMART on FHIR</p>
        <h1>Patient connection</h1>

        {authState.kind === "loading" && (
          <p>Finishing your secure Epic connection…</p>
        )}

        {authState.kind === "ready" && (
          <>
            <p className="status success">
              Connected securely. Your access token is ready for this session.
            </p>
            <dl>
              {authState.session.patient && (
                <>
                  <dt>Patient</dt>
                  <dd>{authState.session.patient}</dd>
                </>
              )}
              {authState.session.encounter && (
                <>
                  <dt>Encounter</dt>
                  <dd>{authState.session.encounter}</dd>
                </>
              )}
              {authState.session.scope && (
                <>
                  <dt>Scope</dt>
                  <dd>{authState.session.scope}</dd>
                </>
              )}
            </dl>
            <div className="actions">
              <button
                type="button"
                disabled={dataStatus === "loading"}
                onClick={() => fetchData(authState.session)}
              >
                {dataStatus === "loading" ? "Fetching data…" : "Fetch data"}
              </button>
              <button
                type="button"
                onClick={openNoteDialog}
              >
                Create note
              </button>
              <button
                type="button"
                onClick={openTeleEncounterDialog}
              >
                Create tele encounter
              </button>
              {/* <button
                type="button"
                onClick={() => copyAccessToken(authState.session.accessToken)}
              >
                {copyStatus === 'copied' ? 'Access token copied' : 'Copy access token'}
              </button> */}
              <button
                type="button"
                className="secondary"
                onClick={disconnect}
              >
                Disconnect
              </button>
            </div>
            {copyStatus === "error" && (
              <p
                className="copy-error"
                role="alert"
              >
                Your browser blocked clipboard access. Copy the token from your
                integration session instead.
              </p>
            )}
            {dataStatus === "success" && (
              <p className="fetch-status success">
                Workflow data fetched successfully.
              </p>
            )}
            {dataStatus === "error" && (
              <p
                className="fetch-status error"
                role="alert"
              >
                Unable to fetch workflow data. Try again.
              </p>
            )}
            {workflowData?.patient && (
              <section
                className="patient-data"
                aria-labelledby="patient-data-title"
              >
                <h2 id="patient-data-title">Patient details</h2>
                <p className="patient-name">
                  {formatPatientName(workflowData.patient)}
                </p>
                <dl>
                  {workflowData.patient.birthDate && (
                    <>
                      <dt>Date of birth</dt>
                      <dd>{formatDate(workflowData.patient.birthDate)}</dd>
                    </>
                  )}
                  {workflowData.patient.gender && (
                    <>
                      <dt>Gender</dt>
                      <dd>{workflowData.patient.gender}</dd>
                    </>
                  )}
                  {workflowData.patient.telecom?.[0]?.value && (
                    <>
                      <dt>Contact</dt>
                      <dd>{workflowData.patient.telecom[0].value}</dd>
                    </>
                  )}
                  {workflowData.patient.address?.[0] && (
                    <>
                      <dt>Address</dt>
                      <dd>
                        {[
                          ...(workflowData.patient.address[0].line || []),
                          workflowData.patient.address[0].city,
                          workflowData.patient.address[0].state,
                          workflowData.patient.address[0].postalCode,
                          workflowData.patient.address[0].country,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </dd>
                    </>
                  )}
                </dl>
                {workflowData.singleEncounter && (
                  <section
                    className="launched-encounter"
                    aria-labelledby="launched-encounter-title"
                  >
                    <h2 id="launched-encounter-title">Launched encounter</h2>
                    <p className="encounter-name">
                      {formatEncounterType(workflowData.singleEncounter)}
                    </p>
                    <dl>
                      <dt>Status</dt>
                      <dd>
                        {workflowData.singleEncounter.status || "Unknown"}
                      </dd>
                      {workflowData.singleEncounter.class?.code && (
                        <>
                          <dt>Care setting</dt>
                          <dd>
                            {workflowData.singleEncounter.class.display ||
                              workflowData.singleEncounter.class.code}
                          </dd>
                        </>
                      )}
                      <dt>Start</dt>
                      <dd>
                        {formatDateTime(
                          workflowData.singleEncounter.period?.start,
                        )}
                      </dd>
                      <dt>End</dt>
                      <dd>
                        {formatDateTime(
                          workflowData.singleEncounter.period?.end,
                        )}
                      </dd>
                    </dl>
                  </section>
                )}
              </section>
            )}
            {workflowData?.encounters && (
              <section
                className="encounters"
                aria-labelledby="encounters-title"
              >
                <h2 id="encounters-title">
                  Encounter history ({workflowData.encounters.length})
                </h2>
                <ul>
                  {[...workflowData.encounters]
                    .sort((a, b) =>
                      (b.period?.start || "").localeCompare(
                        a.period?.start || "",
                      ),
                    )
                    .map((encounter, index) => (
                      <li key={encounter.id || index}>
                        <span>{formatEncounterType(encounter)}</span>
                        <small>
                          {formatDate(encounter.period?.start)} ·{" "}
                          {encounter.status || "unknown status"}
                        </small>
                      </li>
                    ))}
                </ul>
              </section>
            )}
            {documents.length > 0 && (
              <section
                className="documents"
                aria-labelledby="documents-title"
              >
                <h2 id="documents-title">Documents ({documents.length})</h2>
                <ul>
                  {[...documents]
                    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                    .map((document, index) => {
                      const attachment = document.content?.[0]?.attachment;
                      const text =
                        attachment?.contentType === "text/plain"
                          ? decodeDocumentText(attachment.data)
                          : null;

                      return (
                        <li key={document.id || index}>
                          <div>
                            <strong>{formatDocumentTitle(document)}</strong>
                            {text && <p>{text}</p>}
                            {!text && attachment?.contentType && (
                              <p>{attachment.contentType} attachment</p>
                            )}
                          </div>
                          <small>
                            {formatDateTime(document.date)} ·{" "}
                            {document.docStatus ||
                              document.status ||
                              "unknown status"}
                          </small>
                        </li>
                      );
                    })}
                </ul>
              </section>
            )}
            {diagnosticReports.length > 0 && (
              <section
                className="diagnostic-reports"
                aria-labelledby="diagnostics-title"
              >
                <h2 id="diagnostics-title">
                  Diagnostic reports ({diagnosticReports.length})
                </h2>
                <ul>
                  {[...diagnosticReports]
                    .sort((a, b) =>
                      (b.effectiveDateTime || b.issued || "").localeCompare(
                        a.effectiveDateTime || a.issued || "",
                      ),
                    )
                    .map((report, index) => (
                      <li key={report.id || index}>
                        <div>
                          <strong>{formatDiagnosticName(report)}</strong>
                          {formatDiagnosticCategory(report) && (
                            <small>{formatDiagnosticCategory(report)}</small>
                          )}
                          {report.result?.length ? (
                            <p>
                              Results:{" "}
                              {report.result
                                .map((result) => result.display)
                                .filter(Boolean)
                                .join(", ")}
                            </p>
                          ) : null}
                        </div>
                        <small>
                          {formatDate(
                            report.effectiveDateTime || report.issued,
                          )}{" "}
                          · {report.status || "unknown status"}
                        </small>
                      </li>
                    ))}
                </ul>
              </section>
            )}
            {isNoteDialogOpen && (
              <div
                className="modal-backdrop"
                role="presentation"
              >
                <section
                  className="note-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="note-dialog-title"
                >
                  <h2 id="note-dialog-title">Create patient note</h2>
                  <label htmlFor="patient-note">Note</label>
                  <textarea
                    id="patient-note"
                    value={noteText}
                    onChange={(event) => setNoteText(event.target.value)}
                    placeholder="Write the progress note…"
                    disabled={
                      noteStatus === "saving" || noteStatus === "success"
                    }
                    autoFocus
                  />
                  {noteStatus === "error" && (
                    <p
                      className="note-error"
                      role="alert"
                    >
                      Enter a note and try again. The note was not saved.
                    </p>
                  )}
                  {noteStatus === "success" && (
                    <p className="note-success">
                      Patient note created successfully.
                    </p>
                  )}
                  <div className="actions">
                    {noteStatus !== "success" && (
                      <button
                        type="button"
                        disabled={noteStatus === "saving" || !noteText.trim()}
                        onClick={() => submitNote(authState.session)}
                      >
                        {noteStatus === "saving"
                          ? "Creating note…"
                          : "Create note"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      onClick={closeNoteDialog}
                    >
                      {noteStatus === "success" ? "Done" : "Cancel"}
                    </button>
                  </div>
                </section>
              </div>
            )}
            {isTeleEncounterDialogOpen && (
              <div
                className="modal-backdrop"
                role="presentation"
              >
                <section
                  className="note-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="tele-encounter-dialog-title"
                >
                  <h2 id="tele-encounter-dialog-title">
                    Create tele encounter
                  </h2>
                  <label htmlFor="tele-encounter-start">
                    Start date and time
                  </label>
                  <input
                    id="tele-encounter-start"
                    type="datetime-local"
                    value={teleEncounterStart}
                    onChange={(event) =>
                      setTeleEncounterStart(event.target.value)
                    }
                    disabled={
                      teleEncounterStatus === "saving" ||
                      teleEncounterStatus === "success"
                    }
                  />
                  <label htmlFor="tele-encounter-end">End date and time</label>
                  <input
                    id="tele-encounter-end"
                    type="datetime-local"
                    value={teleEncounterEnd}
                    onChange={(event) =>
                      setTeleEncounterEnd(event.target.value)
                    }
                    disabled={
                      teleEncounterStatus === "saving" ||
                      teleEncounterStatus === "success"
                    }
                  />
                  {teleEncounterStatus === "error" && (
                    <p
                      className="note-error"
                      role="alert"
                    >
                      Provide a valid start and end time, then try again.
                    </p>
                  )}
                  {teleEncounterStatus === "success" && (
                    <p className="note-success">
                      Tele encounter created successfully.
                    </p>
                  )}
                  <div className="actions">
                    {teleEncounterStatus !== "success" && (
                      <button
                        type="button"
                        disabled={
                          teleEncounterStatus === "saving" ||
                          !teleEncounterStart ||
                          !teleEncounterEnd
                        }
                        onClick={() => submitTeleEncounter(authState.session)}
                      >
                        {teleEncounterStatus === "saving"
                          ? "Creating encounter…"
                          : "Create encounter"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      onClick={closeTeleEncounterDialog}
                    >
                      {teleEncounterStatus === "success" ? "Done" : "Cancel"}
                    </button>
                  </div>
                </section>
              </div>
            )}
          </>
        )}

        {authState.kind === "error" && (
          <p className="status error">
            Unable to connect to Epic: {authState.message}
          </p>
        )}

        {authState.kind === "idle" && (
          <p>Open this app from an Epic launch to connect a patient session.</p>
        )}
      </section>
    </main>
  );
}

export default App;
