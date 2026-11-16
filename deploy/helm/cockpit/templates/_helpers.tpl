{{/*
Expand the name of the chart.
*/}}
{{- define "cockpit.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "cockpit.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "cockpit.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "cockpit.labels" -}}
helm.sh/chart: {{ include "cockpit.chart" . }}
{{ include "cockpit.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
stackable.tech/vendor: stackable
{{- end }}

{{/*
Selector labels
*/}}
{{- define "cockpit.selectorLabels" -}}
app.kubernetes.io/name: {{ include "cockpit.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: ui
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "cockpit.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "cockpit.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Name of the generated session secret. The suffix keeps it from colliding with a
user-created Secret named like the release, e.g. one holding the database password.
*/}}
{{- define "cockpit.sessionSecretName" -}}
{{- printf "%s-session" (include "cockpit.fullname" . | trunc 55 | trimSuffix "-") }}
{{- end }}

{{- define "cockpit.sessionSecret" -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace (include "cockpit.sessionSecretName" .) }}
{{- if and $existing $existing.data (index $existing.data "session-secret") }}
{{- index $existing.data "session-secret" | b64dec }}
{{- else }}
{{- randAlphaNum 64 }}
{{- end }}
{{- end }}

{{/*
Image name
*/}}
{{- define "cockpit.image" -}}
{{- if .Values.image.registry }}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- else }}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- end }}
{{- end }}

{{/*
Fail on invalid TLS settings, so that no setting is silently ignored.
*/}}
{{- define "cockpit.validateTls" -}}
{{- $dbTls := .Values.database.tls }}
{{- $validModes := list "verify-full" "require" "disable" }}
{{- if and $dbTls.mode (not (has $dbTls.mode $validModes)) }}
{{- fail (printf "database.tls.mode must be one of %s (got %q)" (join ", " $validModes) $dbTls.mode) }}
{{- end }}
{{- $secretClasses := .Values.tls.secretClasses }}
{{- if ne (len $secretClasses) (len (uniq $secretClasses)) }}
{{- fail "tls.secretClasses must not contain duplicates" }}
{{- end }}
{{- range $secretClasses }}
{{- if not . }}
{{- fail "tls.secretClasses must not contain empty entries" }}
{{- end }}
{{- end }}
{{- range .Values.tls.caCerts }}
{{- if or (not .) (contains "," .) }}
{{- fail (printf "tls.caCerts entries must be non-empty paths without commas (got %q)" .) }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Comma-separated CA certificate files for STACKABLE_COCKPIT_TLS_CA_CERTS: the tls.caCerts paths
and the ca.crt mounted for each of tls.secretClasses. Empty when none are configured.
*/}}
{{- define "cockpit.caCertPaths" -}}
{{- $paths := list }}
{{- range .Values.tls.caCerts }}
{{- $paths = append $paths . }}
{{- end }}
{{- range .Values.tls.secretClasses }}
{{- $paths = append $paths (printf "/stackable/tls-ca/%s/ca.crt" .) }}
{{- end }}
{{- join "," $paths }}
{{- end }}

{{/*
Database port, validated: int64 turns "" or "abc" into 0, which would fail only at connect time.
*/}}
{{- define "cockpit.databasePort" -}}
{{- $port := .Values.database.port | int64 }}
{{- if or (lt $port 1) (gt $port 65535) }}
{{- fail (printf "database.port must be a port number between 1 and 65535 (got %v)" .Values.database.port) }}
{{- end }}
{{- $port }}
{{- end }}

{{/*
A value as a quoted environment variable. A whole number arrives as float64 and would render
as 5.24288e+06. Anything else is passed through unchanged for the application to validate.
*/}}
{{- define "cockpit.envValue" -}}
{{- if and (kindIs "float64" .) (eq (floor .) .) }}{{ int64 . | quote }}{{ else }}{{ . | quote }}{{ end }}
{{- end }}

{{/*
"true" when a value is set: not omitted, null or an empty string. Unlike `with`, 0 and false
count as set, so the application rejects them instead of the chart dropping them.
*/}}
{{- define "cockpit.isSet" -}}
{{- if and (not (kindIs "invalid" .)) (ne (toString .) "") }}true{{ end }}
{{- end }}
