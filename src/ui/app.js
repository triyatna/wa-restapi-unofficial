/* ====== State & constants ====== */
let currentRole = null;

const LS_KEYS = {
  apiKey: "wa.apiKey",
  baseUrl: "wa.baseUrl",
  currentSessionId: "wa.currentSessionId",
};

let ioClient = null;
let currentSessionId = localStorage.getItem(LS_KEYS.currentSessionId) || "";

/* ====== DOM helpers ====== */
const el = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function setUIByRole(role) {
  currentRole = role;
  const sSess = document.getElementById("secSessions");
  const sMsg = document.getElementById("secMessaging");
  const sHealth = document.getElementById("secHealth");

  if (sMsg) sMsg.style.display = ""; // selalu ada saat connected
  if (sHealth) sHealth.style.display = ""; // selalu ada saat connected
  if (sSess) {
    // hanya admin yang boleh lihat "Create / Manage Session"
    sSess.style.display = role === "admin" ? "" : "none";
  }
}

function toast(msg, kind = "ok") {
  let t = document.querySelector(".toast");
  if (!t) return;
  t.textContent = msg;
  t.style.borderColor =
    kind === "ok" ? "#16a34a" : kind === "warn" ? "#eab308" : "#ef4444";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2000);
}

function setSockDot(state) {
  const dot = el("sockDot");
  if (!dot) return;
  dot.classList.remove("status-online", "status-offline", "status-reconn");
  if (state === "online") dot.classList.add("status-online");
  else if (state === "reconn") dot.classList.add("status-reconn");
  else dot.classList.add("status-offline");
  dot.title =
    state === "online"
      ? "socket online"
      : state === "reconn"
      ? "reconnecting…"
      : "socket offline";
}

function gateButtons(disabled) {
  const ids = [
    "btnCreate",
    "btnRefresh",
    "btnJoinQR",
    "btnDeleteSess",
    "btnSendText",
    "btnSendMedia",
    "btnSendLocation",
    "btnSendButtons",
    "btnSendList",
    "btnSendPoll",
    "btnSendSticker",
    "btnSendVcard",
    "btnSendGif",
    "btnHealth",
  ];
  ids.forEach((id) => {
    const b = el(id);
    if (b) b.disabled = disabled;
  });
}

/* ====== QR panel helpers ====== */
function setQRPanelActive(active) {
  const split = document.querySelector("#secSessions .section-split");
  const qrWrap = document.getElementById("qrWrap");
  if (!split || !qrWrap) return;
  qrWrap.classList.toggle("hidden", !active);
  split.classList.toggle("no-qr", !active); // no-qr => 1 kolom
}

/** Tampilkan/sembunyikan area QR + bersihkan kontennya saat off */
function setQRVisible(flag) {
  const area = el("qrArea");
  if (!area) return;
  setQRPanelActive(flag);

  if (!flag) {
    const img = el("qrImg");
    if (img) img.src = "";
    const meta = el("qrMeta");
    if (meta) meta.textContent = "";
    area.classList.add("hidden");
    return;
  }

  // ON: pastikan terlihat
  area.classList.remove("hidden");
}

function renderQRImage(qr, sessionId) {
  setQRVisible(true);
  const base = (el("baseUrl").value.trim() || window.location.origin).replace(
    /\/$/,
    ""
  );
  el("qrImg").src = `${base}/utils/qr.png?data=${encodeURIComponent(qr)}`;
  el("qrMeta").textContent = `Session: ${sessionId} • QR akan refresh otomatis`;
}

/* ====== API helper ====== */
async function api(path, method = "GET", body, retry = 0) {
  const apiKey = el("apiKey").value.trim();
  const base = (el("baseUrl").value.trim() || window.location.origin).replace(
    /\/$/,
    ""
  );
  if (!apiKey) throw new Error('{"error":"Missing X-API-Key"}');

  try {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      if (r.status === 401 || r.status === 403) {
        throw new Error("Unauthorized: Invalid X-API-Key");
      }
      throw new Error(txt || r.statusText);
    }
    return r.json();
  } catch (e) {
    if (retry < 2) {
      await new Promise((r) => setTimeout(r, 600));
      return api(path, method, body, retry + 1);
    }
    throw e;
  }
}

/* ====== UI helpers ====== */
function setSessionInfo(s) {
  const wrap = el("sessionInfo");
  if (!wrap) return;
  const info = [
    `<div><b>${s.id}</b> <span class="pill">${s.status}</span></div>`,
    `<div class="muted">${
      s.me
        ? 'Logged in as: <span class="code">' +
          (s.me?.user || s.me?.id || "") +
          "</span>"
        : "Belum login"
    }</div>`,
    `<div class="muted">Last connect: ${
      s.lastConn ? new Date(s.lastConn).toLocaleString() : "-"
    }</div>`,
  ].join("");
  wrap.innerHTML = info;
}

function fillSessionSelect(items) {
  const sel = el("sessionSelect");
  const old = sel.value;
  sel.innerHTML = '<option value="">-- pilih session --</option>';

  items.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.id} (${s.status})`;
    if (s.id === currentSessionId) opt.selected = true;
    sel.appendChild(opt);
  });

  // fallback ke old kalau currentSessionId kosong tapi old masih ada
  if (!currentSessionId && items.some((x) => x.id === old)) sel.value = old;
}

function updateActiveUI() {
  // Kartu grid
  document.querySelectorAll("#sessions .card").forEach((card) => {
    const id = card.getAttribute("data-id");
    if (!id) return;
    const active = id === currentSessionId;
    card.classList.toggle("is-active", active);
    const btn = card.querySelector(".btn-set-active");
    if (btn) {
      btn.textContent = active ? "Active" : "Set Active";
      btn.disabled = active;
      btn.classList.toggle("btn-primary", !active);
      btn.classList.toggle("btn-accent", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    }
  });

  // Dropdown
  const sel = el("sessionSelect");
  if (sel && currentSessionId) {
    if ([...sel.options].some((o) => o.value === currentSessionId)) {
      sel.value = currentSessionId;
    }
  }
}

/* ====== Socket connect & auto-reconnect ====== */
function connectSocket({ silent = false } = {}) {
  const apiKey = el("apiKey").value.trim();
  const base = (el("baseUrl").value.trim() || window.location.origin).replace(
    /\/$/,
    ""
  );
  if (!apiKey || !base) {
    if (!silent) toast("Isi API key & Base URL", "warn");
    return;
  }

  try {
    if (ioClient) {
      ioClient.removeAllListeners();
      ioClient.disconnect();
      ioClient = null;
    }

    ioClient = io(base, {
      transports: ["websocket"],
      auth: { apiKey },
      withCredentials: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    ioClient.on("connect", () => {
      setSockDot("online");
      gateButtons(false);
      setConnectedUI(true);
      if (!silent) toast("Socket connected");

      if (currentSessionId) {
        ioClient.emit("join", { room: currentSessionId });
      }
      el("btnRefresh")?.click();
    });

    ioClient.on("welcome", ({ role }) => {
      if (!role) return;
      setUIByRole(role);
    });

    ioClient.on("reconnect_attempt", () => setSockDot("reconn"));
    ioClient.on("reconnect", () => {
      setSockDot("online");
      gateButtons(false);
      setConnectedUI(true);
      el("btnRefresh")?.click();
    });
    ioClient.on("reconnect_error", () => setSockDot("reconn"));
    ioClient.on("reconnect_failed", () => {
      setSockDot("offline");
      gateButtons(true);
      setConnectedUI(false);
    });

    ioClient.on("connect_error", (err) => {
      setSockDot("offline");
      gateButtons(true);
      setConnectedUI(false);
      currentRole = null; // reset
      let msg = "connect_error";
      if (err?.data?.code === 401) msg = "Invalid X-API-Key";
      else if (err && (err.message || err.data)) msg = err.message || err.data;
      if (!silent) toast("Error: " + msg, "err");
      console.debug("[socket connect_error]", err);
    });

    ioClient.on("disconnect", (reason) => {
      setSockDot("offline");
      setConnectedUI(false);
      currentRole = null;
      if (reason !== "io client disconnect")
        toast("Disconnected: " + reason, "warn");
    });

    // ==== live QR events ====
    ioClient.on("qr", ({ id, qr }) => {
      if (id !== currentSessionId) return;
      setQRVisible(true);
      renderQRImage(qr, id);
    });

    ioClient.on("ready", ({ id }) => {
      if (id !== currentSessionId) return;
      setQRVisible(false);
      const joinBtn = el("btnJoinQR");
      if (joinBtn) {
        joinBtn.style.display = "none";
        joinBtn.disabled = true;
      }
      el("btnRefresh")?.click();
    });

    ioClient.on("closed", ({ id }) => {
      if (id !== currentSessionId) return;
      toast("Session closed", "warn");
      setQRVisible(true); // perlu login ulang
      el("btnRefresh")?.click();
    });
  } catch (e) {
    console.error(e);
    if (!silent) toast(e.message || "Gagal inisialisasi socket", "err");
    setConnectedUI(false);
  }
}

function setConnectedUI(connected) {
  const s1 = el("secSessions");
  const s2 = el("secMessaging");
  const s3 = el("secHealth");
  if (s1) s1.style.display = connected ? "" : "none";
  if (s2) s2.style.display = connected ? "" : "none";
  if (s3) s3.style.display = connected ? "" : "none";

  const btn = el("btnLoad");
  if (btn) {
    if (connected) {
      btn.textContent = "Log Out";
      btn.classList.remove("btn-primary");
      btn.classList.add("btn-danger");
      btn.setAttribute("aria-label", "Log out from Socket");
    } else {
      btn.textContent = "Connect";
      btn.classList.remove("btn-danger");
      btn.classList.add("btn-primary");
      btn.setAttribute("aria-label", "Connect to Socket");
    }
  }
}

function logoutSocket() {
  try {
    if (ioClient) {
      ioClient.removeAllListeners();
      ioClient.disconnect();
      ioClient = null;
    }
  } catch (_) {}
  currentRole = null;
  setSockDot("offline");
  gateButtons(true);
  setConnectedUI(false);
  setQRVisible(false);
}

/* ====== Persist helpers ====== */
function persistInputs() {
  localStorage.setItem(LS_KEYS.apiKey, el("apiKey").value.trim());
  localStorage.setItem(LS_KEYS.baseUrl, el("baseUrl").value.trim());
  localStorage.setItem(LS_KEYS.currentSessionId, currentSessionId || "");
}

function loadInputsFromStorage() {
  const savedApiKey = localStorage.getItem(LS_KEYS.apiKey) || "";
  const savedBase =
    localStorage.getItem(LS_KEYS.baseUrl) || window.location.origin;
  if (!el("apiKey").value) el("apiKey").value = savedApiKey;
  if (!el("baseUrl").value) el("baseUrl").value = savedBase;
}

/* ====== Boot ====== */
document.addEventListener("DOMContentLoaded", async () => {
  setConnectedUI(false);
  loadInputsFromStorage();
  if (!el("baseUrl").value) el("baseUrl").value = window.location.origin;
  gateButtons(true);

  // Auto-connect saat ada kredensial tersimpan
  if (el("apiKey").value && el("baseUrl").value) {
    connectSocket({ silent: true });

    // Jika ada sesi aktif tersimpan, coba tarik detail & tentukan QR panel
    if (currentSessionId) {
      try {
        const detail = await api("/api/sessions/" + currentSessionId);
        setSessionInfo(detail);

        if (detail.status === "open") {
          setQRVisible(false);
        } else {
          setQRVisible(true);
          if (detail.qr) renderQRImage(detail.qr, currentSessionId);
        }
      } catch {
        // retry kecil
        setTimeout(async () => {
          try {
            const detail = await api("/api/sessions/" + currentSessionId);
            setSessionInfo(detail);
            if (detail.status === "open") {
              setQRVisible(false);
            } else {
              setQRVisible(true);
              if (detail.qr) renderQRImage(detail.qr, currentSessionId);
            }
          } catch {}
        }, 800);
      }
    }
  }

  document.querySelector("[data-autofocus]")?.focus();
});

/* ====== Controls: Connect ====== */
el("btnLoad").addEventListener("click", () => {
  if (ioClient?.connected) {
    logoutSocket();
    toast("Logged out from UI socket", "warn");
    return;
  }
  persistInputs();
  connectSocket();
});

async function apiDeleteSession(id, mode = "runtime") {
  return api(
    `/api/sessions/${encodeURIComponent(id)}?mode=${encodeURIComponent(mode)}`,
    "DELETE"
  );
}

/* ====== Sessions ====== */
function attachSessionCardsHandlers(wrap) {
  wrap.querySelectorAll(".btn-del").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const id = btn.dataset.id;
        const mode = prompt(
          `Hapus apa?\n- runtime  : stop sementara (default)\n- creds    : hapus kredensial (paksa QR lagi)\n- meta     : hapus dari registry (hilang dari list)\n- all      : semuanya (runtime + creds + meta)\n\nKetik salah satu (runtime/creds/meta/all):`,
          "runtime"
        );
        if (!mode) return;

        await apiDeleteSession(id, mode.trim().toLowerCase());
        if (currentSessionId === id && (mode === "all" || mode === "runtime")) {
          currentSessionId = "";
          persistInputs();
          setQRVisible(false);
          el("sessionInfo").innerHTML = "";
        }
        el("btnRefresh").click();
        toast(`Deleted (${mode})`, mode === "runtime" ? "warn" : "err");
      } catch (e) {
        toast(e.message || "Error", "err");
      }
    })
  );

  wrap.querySelectorAll(".btn-join").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (ioClient?.connected) {
        ioClient.emit("join", { room: btn.dataset.id });
        toast("Joined QR room: " + btn.dataset.id);
      } else {
        toast("Identify belum connect. Klik Connect dulu.", "warn");
      }
    })
  );

  wrap.querySelectorAll(".btn-set-active").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        currentSessionId = btn.dataset.id;
        persistInputs();
        el("sessionSelect").value = currentSessionId;

        const detail = await api("/api/sessions/" + currentSessionId);
        setSessionInfo(detail);

        if (ioClient?.connected)
          ioClient.emit("join", { room: currentSessionId });

        if (detail.status === "open") {
          setQRVisible(false);
        } else {
          setQRVisible(true);
          if (detail.qr) renderQRImage(detail.qr, currentSessionId);
        }
        updateActiveUI();
      } catch (e) {
        toast(e.message || "Error", "err");
      }
    })
  );
}

el("btnCreate").addEventListener("click", async () => {
  try {
    const payload = {
      id: el("sessId").value || undefined,
      webhookUrl: el("whUrl").value || undefined,
      webhookSecret: el("whSecret").value || undefined,
    };
    const out = await api("/api/sessions", "POST", payload);
    toast("Started session " + out.id);
    currentSessionId = out.id;
    persistInputs();
    if (ioClient?.connected) ioClient.emit("join", { room: currentSessionId });
    el("btnRefresh").click();
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

el("btnRefresh").addEventListener("click", async () => {
  try {
    const out = await api("/api/sessions");
    const items = out.items || out.data || [];
    fillSessionSelect(items);

    const wrap = el("sessions");
    wrap.innerHTML = "";
    items.forEach((s) => {
      const isActive = s.id === currentSessionId;
      const div = document.createElement("div");
      div.className = "card" + (isActive ? " is-active" : "");
      div.setAttribute("data-id", s.id);
      div.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
           <div><b>${s.id}</b> <span class="pill">${s.status}</span></div>
           <div class="muted">${s.me ? "Logged in" : "Not logged in"}</div>
         </div>
         <div class="row mt-8">
    <button data-id="${s.id}" class="btn-join" ${
        s.status === "open" ? 'style="display:none"' : ""
      }>Join QR</button>
    <button data-id="${s.id}" class="btn-set-active ${
        isActive ? "btn-accent" : "btn-primary"
      }" ${isActive ? "disabled" : ""}>
      ${isActive ? "Active" : "Set Active"}
    </button>
    <button data-id="${s.id}" class="btn-del btn-danger">Delete</button>
  </div>`;
      wrap.appendChild(div);
    });

    attachSessionCardsHandlers(wrap);
    updateActiveUI();
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

const joinBtn = el("btnJoinQR");
if (joinBtn) {
  joinBtn.style.display = detail.status === "open" ? "none" : "";
  joinBtn.disabled = detail.status === "open";
}

el("btnJoinQR").addEventListener("click", () => {
  const id = el("sessionSelect").value;
  if (!id) return toast("Pilih session dulu", "warn");
  currentSessionId = id;
  persistInputs();
  if (ioClient?.connected) {
    ioClient.emit("join", { room: id });
    updateActiveUI();
    toast("Joined QR room: " + id);
  } else {
    toast("Identify belum connect. Klik Connect dulu.", "warn");
  }
});

el("btnDeleteSess").addEventListener("click", async () => {
  const id = el("sessionSelect").value;
  if (!id) return toast("Pilih session", "warn");
  try {
    const mode = prompt("Hapus apa? (runtime/creds/meta/all)", "all") || "all";
    await apiDeleteSession(id, mode.trim().toLowerCase());
    if (currentSessionId === id && (mode === "all" || mode === "runtime")) {
      currentSessionId = "";
      persistInputs();
      setQRVisible(false);
    }
    el("btnRefresh").click();
    updateActiveUI();
    toast(`Session deleted (${mode})`, "warn");
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

el("sessionSelect").addEventListener("change", async () => {
  const id = el("sessionSelect").value;
  if (!id) return;
  try {
    currentSessionId = id;
    persistInputs();
    const detail = await api("/api/sessions/" + id);
    setSessionInfo(detail);

    // QR hanya muncul bila belum open
    if (detail.status === "open") {
      setQRVisible(false);
    } else {
      setQRVisible(true);
      if (detail.qr) renderQRImage(detail.qr, id);
    }

    if (ioClient?.connected) ioClient.emit("join", { room: id });
    updateActiveUI();
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

/* ====== Tabs ====== */
const tabs = document.getElementById("tabs");
tabs.addEventListener("click", (e) => {
  const t = e.target.closest(".tab");
  if (!t) return;
  const name = t.dataset.tab;
  $$(".tab").forEach((x) => {
    x.classList.toggle("active", x === t);
    x.setAttribute("aria-selected", x === t ? "true" : "false");
  });
  $$(".tab-pane").forEach((p) =>
    p.classList.toggle("hidden", p.id !== "pane-" + name)
  );
});
tabs.addEventListener("keydown", (e) => {
  const tabsEls = $$("#tabs .tab");
  const idx = tabsEls.findIndex((x) => x === document.activeElement);
  if (idx < 0) return;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    e.preventDefault();
    const next = tabsEls[(idx + 1) % tabsEls.length];
    next.focus();
    next.click();
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    const prev = tabsEls[(idx - 1 + tabsEls.length) % tabsEls.length];
    prev.focus();
    prev.click();
  }
});

function requireSession() {
  if (!currentSessionId) {
    toast("Pilih/aktifkan session dulu", "warn");
    throw new Error("no session");
  }
}

/* ====== Messaging actions ====== */
async function send(path, body) {
  requireSession();
  return api(path, "POST", body);
}

el("btnSendText").addEventListener("click", async () => {
  try {
    const to = el("t_to").value.trim();
    const text = el("t_text").value;
    const mentions = el("t_mentions").value.trim()
      ? el("t_mentions")
          .value.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    await send("/api/messages/text", {
      sessionId: currentSessionId,
      to,
      text,
      mentions,
    });
    toast("Text sent");
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

el("btnSendMedia").addEventListener("click", async () => {
  try {
    const to = el("m_to").value.trim();
    const mediaType = el("m_type").value;
    const mediaUrl = el("m_url").value.trim();
    const caption = el("m_caption").value;
    await send("/api/messages/media", {
      sessionId: currentSessionId,
      to,
      mediaType,
      mediaUrl,
      caption,
    });
    toast("Media sent");
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

el("btnSendLocation").addEventListener("click", async () => {
  try {
    const to = el("loc_to").value.trim();
    const lat = parseFloat(el("loc_lat").value);
    const lng = parseFloat(el("loc_lng").value);
    const name = el("loc_name").value;
    const address = el("loc_addr").value;
    await send("/api/messages/location", {
      sessionId: currentSessionId,
      to,
      lat,
      lng,
      name,
      address,
    });
    toast("Location sent");
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

el("btnSendButtons").addEventListener("click", async () => {
  try {
    const to = el("b_to").value.trim();
    const text = el("b_text").value;
    const footer = el("b_footer").value;
    const btns = [el("b_btn1").value, el("b_btn2").value, el("b_btn3").value]
      .map((t, i) =>
        t?.trim() ? { id: `btn_${i + 1}`, text: t.trim() } : null
      )
      .filter(Boolean);
    await send("/api/messages/buttons", {
      sessionId: currentSessionId,
      to,
      text,
      footer,
      buttons: btns,
    });
    toast("Buttons sent");
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

el("btnSendList").addEventListener("click", async () => {
  try {
    const to = el("l_to").value.trim();
    const title = el("l_title").value;
    const text = el("l_text").value;
    const footer = el("l_footer").value;
    const buttonText = el("l_buttonText").value || "Open";
    let sections = [];
    const raw = el("l_sections").value.trim();
    if (raw) sections = JSON.parse(raw);
    await send("/api/messages/list", {
      sessionId: currentSessionId,
      to,
      title,
      text,
      footer,
      buttonText,
      sections,
    });
    toast("List sent");
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

el("btnSendPoll").addEventListener("click", async () => {
  try {
    const to = el("p_to").value.trim();
    const name = el("p_name").value;
    const selectableCount = parseInt(el("p_selectable").value) || 1;
    const options = el("p_options")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await send("/api/messages/poll", {
      sessionId: currentSessionId,
      to,
      name,
      options,
      selectableCount,
    });
    toast("Poll sent");
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

el("btnSendSticker").addEventListener("click", async () => {
  try {
    const to = el("s_to").value.trim();
    const imageUrl = el("s_imageUrl").value.trim();
    await send("/api/messages/sticker", {
      sessionId: currentSessionId,
      to,
      imageUrl,
    });
    toast("Sticker sent");
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

el("btnSendVcard").addEventListener("click", async () => {
  try {
    const to = el("vc_to").value.trim();
    const contact = {
      fullName: el("vc_full").value,
      org: el("vc_org").value,
      phone: el("vc_phone").value,
      email: el("vc_email").value,
    };
    await send("/api/messages/vcard", {
      sessionId: currentSessionId,
      to,
      contact,
    });
    toast("vCard sent");
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

el("btnSendGif").addEventListener("click", async () => {
  try {
    const to = el("g_to").value.trim();
    const videoUrl = el("g_videoUrl").value.trim();
    const caption = el("g_caption").value;
    await send("/api/messages/gif", {
      sessionId: currentSessionId,
      to,
      videoUrl,
      caption,
    });
    toast("GIF sent");
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

/* ====== Health ====== */
el("btnHealth").addEventListener("click", async () => {
  try {
    const out = await api("/health");
    const badge = el("healthBadge");
    badge.innerText = out.status === "ok" ? "OK" : "WARN";
    badge.className = "badge " + (out.status === "ok" ? "ok" : "warn");
    badge.style.display = "inline-block";
    toast("Health checked");
  } catch (e) {
    toast("Health error", "err");
  }
});

/* ====== Cross-tab sync ====== */
window.addEventListener("storage", (ev) => {
  if (
    ev.key === LS_KEYS.apiKey ||
    ev.key === LS_KEYS.baseUrl ||
    ev.key === LS_KEYS.currentSessionId
  ) {
    loadInputsFromStorage();
    currentSessionId = localStorage.getItem(LS_KEYS.currentSessionId) || "";
    connectSocket({ silent: true });
  }
});
