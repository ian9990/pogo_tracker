const TRACKER_STORAGE_KEY = "pogo-tracker-state-v1";
const VARIANTS = ["caught", "shiny", "hundo", "lucky", "xxl", "xxs", "gl", "ul"];
const VARIANT_LABELS = {
  caught: "Caught",
  shiny: "Shiny",
  hundo: "100%",
  lucky: "Lucky",
  xxl: "XXL",
  xxs: "XXS",
  gl: "GL",
  ul: "UL",
};

const statusEl = document.querySelector("#status");
const listEl = document.querySelector("#generation-list");
const cardTemplate = document.querySelector("#pokemon-card-template");
const searchInputEl = document.querySelector("#search-input");
const variantFilterSelectEl = document.querySelector("#variant-filter-select");
const buildSearchBtnEl = document.querySelector("#build-search-btn");
const copySearchBtnEl = document.querySelector("#copy-search-btn");
const goSearchOutputEl = document.querySelector("#go-search-output");
const expandAllBtnEl = document.querySelector("#expand-all-btn");
const collapseAllBtnEl = document.querySelector("#collapse-all-btn");
const exportBtnEl = document.querySelector("#export-btn");
const importBtnEl = document.querySelector("#import-btn");
const importFileInputEl = document.querySelector("#import-file-input");

const state = loadState();
let allPokemon = [];

init().catch((error) => {
  statusEl.textContent = "Failed to load Pokedex data.";
  console.error(error);
});

async function init() {
  const response = await fetch("./pokedex.json");
  if (!response.ok) {
    throw new Error(`Unable to read pokedex.json: ${response.status}`);
  }

  const raw = await response.json();
  allPokemon = normalizeEntries(raw);
  bindControls();
  applyFiltersAndRender();
  updateSearchStringOutput();
}

function normalizeEntries(entries) {
  return entries
    .map((entry) => {
      const name = entry?.names?.English ?? entry?.id ?? "Unknown";
      const formId = entry?.formId ?? entry?.id ?? "";
      const dexNr = Number(entry?.dexNr ?? 0);
      const generation = Number(entry?.generation ?? 0);
      const image = entry?.assets?.image ?? null;

      return {
        key: `${entry?.id ?? "UNKNOWN"}:${formId}`,
        id: entry?.id ?? "UNKNOWN",
        formId,
        name,
        dexNr,
        generation,
        image: typeof image === "string" && image.trim() ? normalizeImageUrl(image) : null,
      };
    })
    .sort((a, b) => {
      if (a.generation !== b.generation) return a.generation - b.generation;
      if (a.dexNr !== b.dexNr) return a.dexNr - b.dexNr;
      return a.name.localeCompare(b.name);
    });
}

function groupByGeneration(pokemon) {
  const grouped = new Map();
  for (const entry of pokemon) {
    const gen = entry.generation || 0;
    if (!grouped.has(gen)) grouped.set(gen, []);
    grouped.get(gen).push(entry);
  }
  return grouped;
}

function renderGenerations(grouped) {
  const openGens = new Set();
  for (const d of listEl.querySelectorAll(".generation.is-open")) {
    const g = d.dataset.gen;
    if (g !== undefined) openGens.add(Number(g));
  }

  listEl.innerHTML = "";
  const generations = [...grouped.keys()].sort((a, b) => a - b);

  for (const gen of generations) {
    const section = document.createElement("div");
    section.className = "generation";
    section.dataset.gen = String(gen);

    const header = document.createElement("button");
    header.type = "button";
    header.className = "generation-header";
    const entries = grouped.get(gen);
    header.append(gen > 0 ? `Generation ${gen}` : "Unknown Generation");
    const count = document.createElement("span");
    count.textContent = getGenerationProgressText(entries);
    header.appendChild(count);

    const contentWrapper = document.createElement("div");
    contentWrapper.className = "generation-content-wrapper";

    const content = document.createElement("div");
    content.className = "generation-content";

    for (const pokemon of entries) {
      content.appendChild(renderPokemonCard(pokemon));
    }

    contentWrapper.appendChild(content);
    section.appendChild(header);
    section.appendChild(contentWrapper);
    listEl.appendChild(section);

    header.addEventListener("click", () => {
      const isOpen = section.classList.toggle("is-open");
      header.setAttribute("aria-expanded", String(isOpen));
    });
  }

  for (const section of listEl.querySelectorAll(".generation")) {
    const g = Number(section.dataset.gen);
    const shouldOpen = openGens.has(g) || (openGens.size === 0 && g === 1);
    section.classList.toggle("is-open", shouldOpen);
    const header = section.querySelector(".generation-header");
    if (header) header.setAttribute("aria-expanded", String(shouldOpen));
  }
}

function renderPokemonCard(pokemon) {
  const fragment = cardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".pokemon-card");
  const nameEl = fragment.querySelector(".pokemon-name");
  const metaEl = fragment.querySelector(".pokemon-meta");
  const imageEl = fragment.querySelector(".pokemon-image");
  const naEl = fragment.querySelector(".pokemon-image-na");
  const caughtRow = fragment.querySelector(".caught-row");
  const variantGrid = fragment.querySelector(".variant-grid");

  card.dataset.pokemonKey = pokemon.key;
  nameEl.textContent = pokemon.name;
  metaEl.textContent = `#${String(pokemon.dexNr).padStart(3, "0")} - ${pokemon.formId}`;

  if (pokemon.image) {
    const imageCandidates = buildImageCandidates(pokemon.image);
    let imageIndex = 0;
    imageEl.src = imageCandidates[imageIndex];
    imageEl.alt = `${pokemon.name} sprite`;
    imageEl.addEventListener("error", () => {
      imageIndex += 1;
      if (imageIndex < imageCandidates.length) {
        imageEl.src = imageCandidates[imageIndex];
        return;
      }
      imageEl.hidden = true;
      naEl.hidden = false;
    });
  } else {
    imageEl.hidden = true;
    naEl.hidden = false;
  }

  const pokemonState = state[pokemon.key] ?? {};
  const caughtButton = createVariantButton("caught", Boolean(pokemonState.caught), (e) => {
    if (!state[pokemon.key]) state[pokemon.key] = {};
    state[pokemon.key].caught = !Boolean(state[pokemon.key].caught);
    if (!state[pokemon.key].caught) {
      for (const v of VARIANTS) {
        if (v !== "caught") state[pokemon.key][v] = false;
      }
    }
    saveState(state);
    updateSearchStringOutput();
    const caughtBtn = e.currentTarget;
    const nowCaught = Boolean(state[pokemon.key].caught);
    caughtBtn.classList.toggle("is-active", nowCaught);
    caughtBtn.setAttribute("aria-pressed", String(nowCaught));
    const cardEl = caughtBtn.closest(".pokemon-card");
    if (cardEl && nowCaught) {
      expandCardToCaught(cardEl, pokemon);
    } else if (cardEl) {
      cardEl.classList.remove("is-caught");
      cardEl.classList.add("is-compact");
      cardEl.querySelector(".variant-grid").innerHTML = "";
    }
    const sectionEl = cardEl?.closest(".generation");
    if (sectionEl) refreshGenerationSummary(sectionEl);
  });
  caughtRow.appendChild(caughtButton);

  if (pokemonState.caught) {
    card.classList.add("is-caught");
    for (const variant of VARIANTS) {
      if (variant === "caught") continue;
      const variantButton = createVariantButton(variant, Boolean(pokemonState[variant]), (e) => {
        if (!state[pokemon.key]) state[pokemon.key] = {};
        state[pokemon.key][variant] = !Boolean(state[pokemon.key][variant]);
        saveState(state);
        updateSearchStringOutput();
        const btn = e.currentTarget;
        const active = Boolean(state[pokemon.key][variant]);
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
      });
      variantGrid.appendChild(variantButton);
    }
  } else {
    card.classList.add("is-compact");
  }

  return card;
}

function getFilteredPokemon() {
  return allPokemon.filter((entry) => matchesSearch(entry) && matchesVariantFilter(entry));
}

function refreshGenerationSummary(sectionEl) {
  const gen = Number(sectionEl.dataset.gen);
  const filtered = getFilteredPokemon();
  const grouped = groupByGeneration(filtered);
  const entries = grouped.get(gen) || [];
  const span = sectionEl.querySelector(".generation-header span");
  if (span) span.textContent = getGenerationProgressText(entries);
}

function expandCardToCaught(cardEl, pokemon) {
  cardEl.classList.remove("is-compact");
  cardEl.classList.add("is-caught");
  const variantGrid = cardEl.querySelector(".variant-grid");
  if (!variantGrid) return;
  variantGrid.innerHTML = "";
  const pokemonState = state[pokemon.key] ?? {};
  for (const variant of VARIANTS) {
    if (variant === "caught") continue;
    const variantButton = createVariantButton(variant, Boolean(pokemonState[variant]), (e) => {
      if (!state[pokemon.key]) state[pokemon.key] = {};
      state[pokemon.key][variant] = !Boolean(state[pokemon.key][variant]);
      saveState(state);
      updateSearchStringOutput();
      const btn = e.currentTarget;
      const active = Boolean(state[pokemon.key][variant]);
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    variantGrid.appendChild(variantButton);
  }
}

function bindControls() {
  searchInputEl.addEventListener("input", applyFiltersAndRender);
  variantFilterSelectEl.addEventListener("change", applyFiltersAndRender);
  buildSearchBtnEl.addEventListener("click", updateSearchStringOutput);
  const builderInputs = document.querySelectorAll('input[name="builder-variant"]');
  for (const input of builderInputs) {
    input.addEventListener("change", updateSearchStringOutput);
  }
  const excludeToggle = document.getElementById("search-string-exclude");
  if (excludeToggle) excludeToggle.addEventListener("change", updateSearchStringOutput);
  copySearchBtnEl.addEventListener("click", async () => {
    const text = goSearchOutputEl.value.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copySearchBtnEl.textContent = "Copied";
      setTimeout(() => {
        copySearchBtnEl.textContent = "Copy";
      }, 1200);
    } catch {
      copySearchBtnEl.textContent = "Copy failed";
      setTimeout(() => {
        copySearchBtnEl.textContent = "Copy";
      }, 1200);
    }
  });

  expandAllBtnEl.addEventListener("click", () => setAllGenerationsOpen(true));
  collapseAllBtnEl.addEventListener("click", () => setAllGenerationsOpen(false));

  exportBtnEl.addEventListener("click", () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pogo-tracker-progress.json";
    link.click();
    URL.revokeObjectURL(url);
  });

  importBtnEl.addEventListener("click", () => importFileInputEl.click());
  importFileInputEl.addEventListener("change", async () => {
    const file = importFileInputEl.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      const importedState = parsed?.state;
      if (!importedState || typeof importedState !== "object") {
        throw new Error("Invalid import format");
      }
      for (const key of Object.keys(importedState)) {
        state[key] = importedState[key];
      }
      saveState(state);
      updateSearchStringOutput();
      applyFiltersAndRender();
    } catch (error) {
      console.error(error);
      statusEl.textContent = "Import failed: invalid JSON file.";
    } finally {
      importFileInputEl.value = "";
    }
  });
}

function setAllGenerationsOpen(open) {
  const generations = listEl.querySelectorAll(".generation");
  for (const section of generations) {
    section.classList.toggle("is-open", open);
    const header = section.querySelector(".generation-header");
    if (header) header.setAttribute("aria-expanded", String(open));
  }
}

function getGenerationProgressText(entries) {
  const caughtCount = entries.reduce((count, entry) => {
    return count + (state?.[entry.key]?.caught ? 1 : 0);
  }, 0);
  return `${caughtCount}/${entries.length} caught`;
}

function updateStatus(totalCount, visibleGenerationCount, visibleCount) {
  statusEl.textContent = `Loaded ${totalCount} forms. Showing ${visibleCount} across ${visibleGenerationCount} generations.`;
}

function applyFiltersAndRender() {
  const filtered = allPokemon.filter((entry) => matchesSearch(entry) && matchesVariantFilter(entry));
  const grouped = groupByGeneration(filtered);
  renderGenerations(grouped);
  updateStatus(allPokemon.length, grouped.size, filtered.length);
}

function createVariantButton(variant, isActive, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "variant-toggle";
  if (isActive) button.classList.add("is-active");
  button.setAttribute("aria-pressed", String(isActive));
  button.title = VARIANT_LABELS[variant];

  const icon = document.createElement("img");
  icon.className = "variant-icon";
  icon.src = `./icons/${variant}.svg`;
  icon.alt = "";
  icon.loading = "lazy";
  button.appendChild(icon);

  const text = document.createElement("span");
  text.textContent = VARIANT_LABELS[variant];
  button.appendChild(text);

  button.addEventListener("click", onClick);
  return button;
}

function matchesSearch(entry) {
  const query = searchInputEl.value.trim().toLowerCase();
  if (!query) return true;
  const dex = String(entry.dexNr);
  return (
    entry.name.toLowerCase().includes(query) ||
    entry.formId.toLowerCase().includes(query) ||
    dex.includes(query)
  );
}

function matchesVariantFilter(entry) {
  const filter = variantFilterSelectEl.value;
  if (!filter || filter === "all") return true;
  const pokemonState = state[entry.key] ?? {};
  if (filter === "uncaught") return !Boolean(pokemonState.caught);
  return Boolean(pokemonState[filter]);
}

function updateSearchStringOutput() {
  const selectedVariants = getBuilderSelectedVariants();
  if (!selectedVariants.length) {
    goSearchOutputEl.value = "";
    goSearchOutputEl.placeholder = "Pick at least one variant option.";
    return;
  }

  const speciesMatched = getSpeciesMatchingAllVariants(selectedVariants);
  if (!speciesMatched.length) {
    goSearchOutputEl.value = "";
    goSearchOutputEl.placeholder = "No species match your selected completion criteria yet.";
    return;
  }

  const excludeMode = document.getElementById("search-string-exclude")?.checked !== false;
  if (excludeMode) {
    goSearchOutputEl.value = speciesMatched.map((dexNr) => `!${dexNr}`).join("&");
  } else {
    goSearchOutputEl.value = speciesMatched.join("&");
  }
}

function getBuilderSelectedVariants() {
  const selected = [];
  const inputs = document.querySelectorAll('input[name="builder-variant"]');
  for (const input of inputs) {
    if (input.checked) selected.push(input.value);
  }
  return selected;
}

function getSpeciesMatchingAllVariants(variants) {
  const byDex = new Map();
  for (const entry of allPokemon) {
    if (!entry.dexNr) continue;
    const current = byDex.get(entry.dexNr) ?? [];
    current.push(entry.key);
    byDex.set(entry.dexNr, current);
  }

  const matchingDex = [];
  for (const [dexNr, keys] of byDex.entries()) {
    const hasComplete = keys.some((key) => {
      const s = state[key] ?? {};
      return variants.every((variant) => Boolean(s[variant]));
    });
    if (hasComplete) matchingDex.push(dexNr);
  }

  matchingDex.sort((a, b) => a - b);
  return matchingDex;
}

function normalizeImageUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.pathname = encodeURI(decodeURI(parsed.pathname));
    return parsed.toString();
  } catch {
    return encodeURI(url);
  }
}

function buildImageCandidates(originalUrl) {
  const normalized = normalizeImageUrl(originalUrl);
  const candidates = [normalized];

  try {
    const parsed = new URL(normalized);
    const isGithubRaw = parsed.hostname === "raw.githubusercontent.com";
    if (isGithubRaw) {
      // raw.githubusercontent.com/<owner>/<repo>/<branch>/<path...>
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 4) {
        const owner = parts[0];
        const repo = parts[1];
        const branch = parts[2];
        const filePath = parts.slice(3).join("/");
        candidates.push(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${filePath}`);
      }
    }
  } catch {
    // Keep original candidate only.
  }

  return [...new Set(candidates)];
}

function loadState() {
  try {
    const raw = localStorage.getItem(TRACKER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveState(nextState) {
  localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(nextState));
}
