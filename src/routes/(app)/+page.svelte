<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
</script>

<div class="mx-auto max-w-6xl space-y-6">
  <div>
    <h2 class="text-base-content text-2xl font-bold">{m.dashboard_welcome()}</h2>
    <p class="text-base-content/60 mt-1 text-sm">{m.dashboard_subtitle()}</p>
  </div>

  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <div class="border-base-300 bg-base-100 rounded-xl border p-5">
      <p class="text-base-content/60 text-xs font-medium tracking-wider uppercase">
        {m.dashboard_services()}
      </p>
      <p class="text-base-content mt-2 text-3xl font-bold">0</p>
      <p class="text-base-content/60 mt-1 text-sm">{m.dashboard_services_empty()}</p>
    </div>

    <div class="border-base-300 bg-base-100 rounded-xl border p-5">
      <p class="text-base-content/60 text-xs font-medium tracking-wider uppercase">
        {m.dashboard_queries()}
      </p>
      <p class="text-base-content mt-2 text-3xl font-bold">&mdash;</p>
      <p class="text-base-content/60 mt-1 text-sm">{m.dashboard_queries_empty()}</p>
    </div>

    <div class="border-base-300 bg-base-100 rounded-xl border p-5">
      <p class="text-base-content/60 text-xs font-medium tracking-wider uppercase">
        {m.dashboard_health()}
      </p>
      <p class="text-base-content mt-2 text-3xl font-bold">
        <span class="text-success">{m.dashboard_health_ok()}</span>
      </p>
      <p class="text-base-content/60 mt-1 text-sm">{m.dashboard_health_status()}</p>
    </div>
  </div>

  <div class="border-base-300 bg-base-100 rounded-xl border p-6">
    <h3 class="text-base-content text-base font-semibold">{m.dashboard_getting_started()}</h3>
    <p class="text-base-content/60 mt-2 text-sm leading-relaxed">
      {m.dashboard_getting_started_description()}
    </p>
    <ol class="mt-4 flex flex-wrap gap-3" aria-label={m.setup_steps_label()}>
      <li
        class="bg-base-200 text-base-content/70 flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
      >
        <span
          class="bg-primary/10 text-primary flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold"
          aria-hidden="true">1</span
        >
        {m.dashboard_step_oidc()}
      </li>
      <li
        class="bg-base-200 text-base-content/70 flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
      >
        <span
          class="bg-primary/10 text-primary flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold"
          aria-hidden="true">2</span
        >
        {m.dashboard_step_trino()}
      </li>
      <li
        class="bg-base-200 text-base-content/70 flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
      >
        <span
          class="bg-primary/10 text-primary flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold"
          aria-hidden="true">3</span
        >
        {m.dashboard_step_browse()}
      </li>
    </ol>
  </div>
</div>
