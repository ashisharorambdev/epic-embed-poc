const EPIC_AUTH_STORAGE_KEY = "epic-auth-session";

type ApiConfiguration = {
  baseUrl: string;
  apiKey: string;
  defaultWorkflowId: string;
};

function getApiConfiguration(): ApiConfiguration {
  const baseUrl = import.meta.env.VITE_EHR_CONNECT_API_BASE_URL?.replace(/\/$/, "");
  const apiKey = import.meta.env.VITE_EHR_CONNECT_API_KEY;
  const defaultWorkflowId = import.meta.env.VITE_EHR_CONNECT_WORKFLOW_ID;

  if (!baseUrl || !apiKey || !defaultWorkflowId) {
    throw new Error(
      "Missing EHR Connect configuration. Set VITE_EHR_CONNECT_API_BASE_URL, VITE_EHR_CONNECT_API_KEY, and VITE_EHR_CONNECT_WORKFLOW_ID.",
    );
  }

  return { baseUrl, apiKey, defaultWorkflowId };
}

export type EpicAuthSession = {
  accessToken: string;
  expiresAt: number;
  tokenType: string;
  scope?: string;
  patient?: string;
  encounter?: string;
  connectionId: string;
  launchPatientId?: string;
  launchEncounterId?: string;
  workflowId?: string;
};

type TokenExchangeResponse = {
  success: boolean;
  data?: {
    access_token: string;
    expires_in: number;
    token_type?: string;
    scope?: string;
    patient?: string;
    encounter?: string;
  };
  message?: string;
};

export async function exchangeEpicToken(
  connectionId: string,
  tokenId: string,
): Promise<EpicAuthSession> {
  const { baseUrl, apiKey } = getApiConfiguration();
  const response = await fetch(
    `${baseUrl}/api/workflow/auth/${encodeURIComponent(connectionId)}/token/exchange/${encodeURIComponent(tokenId)}`,
    {
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey,
      },
    },
  );

  const payload = (await response.json().catch(() => undefined)) as
    | TokenExchangeResponse
    | undefined;

  if (!response.ok || !payload?.success || !payload.data?.access_token) {
    throw new Error(payload?.message || "Epic token exchange failed.");
  }

  return {
    accessToken: payload.data.access_token,
    expiresAt: Date.now() + payload.data.expires_in * 1000,
    tokenType: payload.data.token_type || "Bearer",
    scope: payload.data.scope,
    patient: payload.data.patient,
    encounter: payload.data.encounter,
    connectionId,
  };
}

export async function getWorkflowData(
  patientId: string,
  accessToken: string,
  encounterId?: string,
  workflowId?: string,
): Promise<unknown> {
  const { baseUrl, apiKey, defaultWorkflowId } = getApiConfiguration();
  const targetWorkflowId = workflowId || defaultWorkflowId;
  const response = await fetch(
    `${baseUrl}/api/workflow/${encodeURIComponent(targetWorkflowId)}/get-epic-data`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ patientId, encounterId, access_token: accessToken }),
    },
  );

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String(payload.message)
        : "Unable to retrieve workflow data.";
    throw new Error(message);
  }

  return payload;
}

function toFhirReference(resourceType: "Patient" | "Encounter", id: string) {
  return id.startsWith(`${resourceType}/`) ? id : `${resourceType}/${id}`;
}

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

export async function createPatientNote(
  patientId: string,
  accessToken: string,
  noteText: string,
  encounterId?: string,
  workflowId?: string,
): Promise<unknown> {
  const { baseUrl, apiKey, defaultWorkflowId } = getApiConfiguration();
  const targetWorkflowId = workflowId || defaultWorkflowId;
  const data = {
    resourceType: "DocumentReference",
    status: "current",
    docStatus: "final",
    type: {
      coding: [{
        system: "http://loinc.org",
        code: "11506-3",
        display: "Progress note",
      }],
      text: "Telehealth Progress Note",
    },
    subject: { reference: toFhirReference("Patient", patientId) },
    date: new Date().toISOString(),
    content: [{
      attachment: {
        contentType: "text/plain",
        data: encodeBase64(noteText),
      },
    }],
    context: encounterId
      ? { encounter: [{ reference: toFhirReference("Encounter", encounterId) }] }
      : undefined,
  };

  const response = await fetch(
    `${baseUrl}/api/workflow/${encodeURIComponent(targetWorkflowId)}/create-patient-note`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ patientId, encounterId, access_token: accessToken, data }),
    },
  );

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String(payload.message)
        : "Unable to create the patient note.";
    throw new Error(message);
  }

  return payload;
}

export async function createTeleEncounter(
  patientId: string,
  accessToken: string,
  start: string,
  end: string,
  encounterId?: string,
  workflowId?: string,
): Promise<unknown> {
  const { baseUrl, apiKey, defaultWorkflowId } = getApiConfiguration();
  const targetWorkflowId = workflowId || defaultWorkflowId;
  const data = {
    resourceType: "Encounter",
    status: "finished",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "VR",
      display: "Virtual",
    },
    subject: { reference: toFhirReference("Patient", patientId) },
    period: {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    },
    reasonCode: [{ text: "Telehealth follow-up consultation" }],
  };

  const response = await fetch(
    `${baseUrl}/api/workflow/${encodeURIComponent(targetWorkflowId)}/create-encounter`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ patientId, encounterId, access_token: accessToken, data }),
    },
  );

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String(payload.message)
        : "Unable to create the tele encounter.";
    throw new Error(message);
  }

  return payload;
}

export function saveEpicAuthSession(session: EpicAuthSession) {
  // Keep the bearer token scoped to this browser tab/session, not persistent disk storage.
  sessionStorage.setItem(EPIC_AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function getEpicAuthSession(): EpicAuthSession | null {
  const rawSession = sessionStorage.getItem(EPIC_AUTH_STORAGE_KEY);
  if (!rawSession) return null;

  try {
    const session = JSON.parse(rawSession) as EpicAuthSession;
    if (!session.accessToken || session.expiresAt <= Date.now()) {
      sessionStorage.removeItem(EPIC_AUTH_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    sessionStorage.removeItem(EPIC_AUTH_STORAGE_KEY);
    return null;
  }
}

export function clearEpicAuthSession() {
  sessionStorage.removeItem(EPIC_AUTH_STORAGE_KEY);
}
