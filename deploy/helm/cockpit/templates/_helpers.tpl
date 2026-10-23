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

{{- define "cockpit.sessionSecret" -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace (include "cockpit.fullname" .) }}
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
Fail on TLS settings that contradict each other, so that no setting is silently ignored.
*/}}
{{- define "cockpit.validateTls" -}}
{{- $trinoTls := .Values.trino.tls }}
{{- if and $trinoTls.caCert $trinoTls.secretClass }}
{{- fail "trino.tls.caCert and trino.tls.secretClass are mutually exclusive" }}
{{- end }}
{{- if and $trinoTls.insecure (or $trinoTls.caCert $trinoTls.secretClass) }}
{{- fail "trino.tls.insecure disables certificate verification, so trino.tls.caCert and trino.tls.secretClass would be ignored" }}
{{- end }}
{{- $dbTls := .Values.database.tls }}
{{- $validModes := list "verify-full" "require" "disable" }}
{{- if and $dbTls.mode (not (has $dbTls.mode $validModes)) }}
{{- fail (printf "database.tls.mode must be one of %s (got %q)" (join ", " $validModes) $dbTls.mode) }}
{{- end }}
{{- if and $dbTls.caCert $dbTls.secretClass }}
{{- fail "database.tls.caCert and database.tls.secretClass are mutually exclusive" }}
{{- end }}
{{- $dbMode := $dbTls.mode | default (ternary "verify-full" "disable" (eq .Values.config.nodeEnv "production")) }}
{{- if and (ne $dbMode "verify-full") (or $dbTls.caCert $dbTls.secretClass) }}
{{- fail (printf "database.tls.mode %q does not verify certificates, so database.tls.caCert and database.tls.secretClass would be ignored" $dbMode) }}
{{- end }}
{{- $storageTls := .Values.storage.tls }}
{{- if and $storageTls.caCert $storageTls.secretClass }}
{{- fail "storage.tls.caCert and storage.tls.secretClass are mutually exclusive" }}
{{- end }}
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
