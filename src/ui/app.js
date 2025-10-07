document.addEventListener("DOMContentLoaded", () => {
  const baseUrlInput = document.getElementById("baseUrl");
  if (!baseUrlInput.value) baseUrlInput.value = window.location.origin;
  // kunci tombol sampai Connect sukses
  gateButtons(true);
});

/** Helpers **/
const el = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let ioClient = null;
let currentSessionId = "";

function toast(msg, kind = "ok") {
  let t = document.querySelector(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.borderColor =
    kind === "ok" ? "#16a34a" : kind === "warn" ? "#eab308" : "#ef4444";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
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

function setQRVisible(flag) {
  const area = el("qrArea");
  area.style.display = flag ? "block" : "none";
  if (!flag) {
    el("qrImg").src = "";
    el("qrMeta").textContent = "";
  }
}

// REST helper — selalu baca key/baseUrl langsung dari input
async function api(path, method = "GET", body) {
  const apiKey = el("apiKey").value.trim();
  const base = (el("baseUrl").value.trim() || window.location.origin).replace(
    /\/$/,
    ""
  );
  if (!apiKey) throw new Error('{"error":"Missing X-API-Key"}');

  const r = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(txt || r.statusText);
  }
  return r.json();
}

function setSessionInfo(s) {
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
  el("sessionInfo").innerHTML = info;
}

function fillSessionSelect(items) {
  const sel = el("sessionSelect");
  const old = sel.value;
  sel.innerHTML = '<option value="">-- pilih session --</option>';
  items.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.id} (${s.status})`;
    sel.appendChild(opt);
  });
  if (items.some((x) => x.id === old)) sel.value = old;
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

/** Connect (Socket.IO + auth) **/
el("btnLoad").addEventListener("click", () => {
  const apiKey = el("apiKey").value.trim();
  const base = (el("baseUrl").value.trim() || window.location.origin).replace(
    /\/$/,
    ""
  );
  if (!apiKey || !base) {
    toast("Isi API key & Base URL", "warn");
    return;
  }

  try {
    if (ioClient) {
      ioClient.removeAllListeners();
      ioClient.disconnect();
    }
    ioClient = io(base, {
      transports: ["websocket"],
      auth: { apiKey }, // penting: kirim apiKey sebagai auth
      withCredentials: false,
    });

    ioClient.on("connect", () => {
      gateButtons(false);
      toast("Socket connected");
    });

    ioClient.on("connect_error", (err) => {
      gateButtons(true);
      const msg =
        err && (err.message || err.data)
          ? err.message || err.data
          : "connect_error";
      toast("Socket error: " + msg, "err");
      console.debug("[socket connect_error]", err);
    });

    ioClient.on("disconnect", (reason) => {
      if (reason !== "io client disconnect")
        toast("Socket disconnected: " + reason, "warn");
      // jangan langsung gateButtons(true) biar user bisa re-connect manual
    });

    // events
    ioClient.on("qr", ({ id, qr }) => {
      if (currentSessionId && id !== currentSessionId) return;
      renderQRImage(qr, id);
    });
    ioClient.on("ready", ({ id }) => {
      if (currentSessionId && id !== currentSessionId) return;
      toast("Session ready!");
      setQRVisible(false);
      el("btnRefresh").click();
    });
    ioClient.on("closed", ({ id }) => {
      if (currentSessionId && id !== currentSessionId) return;
      toast("Session closed", "warn");
      el("btnRefresh").click();
    });
  } catch (e) {
    console.error(e);
    toast(e.message || "Gagal inisialisasi socket", "err");
  }
});

/** Sessions **/
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
    if (ioClient?.connected) ioClient.emit("join", { room: currentSessionId });
    el("btnRefresh").click();
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

el("btnRefresh").addEventListener("click", async () => {
  try {
    const out = await api("/api/sessions");
    fillSessionSelect(out.items);
    const wrap = el("sessions");
    wrap.innerHTML = "";
    out.items.forEach((s) => {
      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML =
        `<div><b>${s.id}</b> <span class="pill">${s.status}</span></div>` +
        `<div class="muted">${s.me ? "Logged in" : "Not logged in"}</div>` +
        `<div class="row" style="margin-top:8px">
          <button data-id="${s.id}" class="btn-join">Join QR</button>
          <button data-id="${s.id}" class="btn-set-active btn-primary">Set Active</button>
          <button data-id="${s.id}" class="btn-del btn-danger">Delete</button>
        </div>`;
      wrap.appendChild(div);
    });
    wrap.querySelectorAll(".btn-del").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await api("/api/sessions/" + btn.dataset.id, "DELETE");
          if (currentSessionId === btn.dataset.id) {
            currentSessionId = "";
            setQRVisible(false);
          }
          el("btnRefresh").click();
          toast("Session deleted", "warn");
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
          toast("Socket belum connect. Klik Connect dulu.", "warn");
        }
      })
    );
    wrap.querySelectorAll(".btn-set-active").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          currentSessionId = btn.dataset.id;
          el("sessionSelect").value = currentSessionId;
          const detail = await api("/api/sessions/" + currentSessionId);
          setSessionInfo(detail);
          if (detail.qr) renderQRImage(detail.qr, currentSessionId);
          else setQRVisible(false);
        } catch (e) {
          toast(e.message || "Error", "err");
        }
      })
    );
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

el("btnJoinQR").addEventListener("click", () => {
  const id = el("sessionSelect").value;
  if (!id) return toast("Pilih session dulu", "warn");
  currentSessionId = id;
  if (ioClient?.connected) {
    ioClient.emit("join", { room: id });
    toast("Joined QR room: " + id);
  } else {
    toast("Socket belum connect. Klik Connect dulu.", "warn");
  }
});

el("btnDeleteSess").addEventListener("click", async () => {
  const id = el("sessionSelect").value;
  if (!id) return toast("Pilih session", "warn");
  try {
    await api("/api/sessions/" + id, "DELETE");
    if (currentSessionId === id) {
      currentSessionId = "";
      setQRVisible(false);
    }
    el("btnRefresh").click();
    toast("Session deleted", "warn");
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

el("sessionSelect").addEventListener("change", async () => {
  const id = el("sessionSelect").value;
  if (!id) return;
  try {
    currentSessionId = id;
    const detail = await api("/api/sessions/" + id);
    setSessionInfo(detail);
    if (detail.qr) renderQRImage(detail.qr, id);
    else setQRVisible(false);
  } catch (e) {
    toast(e.message || "Error", "err");
  }
});

/** Tabs **/
const tabs = document.getElementById("tabs");
tabs.addEventListener("click", (e) => {
  const t = e.target.closest(".tab");
  if (!t) return;
  $$(".tab").forEach((x) => x.classList.remove("active"));
  t.classList.add("active");
  const name = t.dataset.tab;
  $$(".tab-pane").forEach((p) => (p.style.display = "none"));
  document.getElementById("pane-" + name).style.display = "block";
});

function requireSession() {
  if (!currentSessionId) {
    toast("Pilih/aktifkan session dulu", "warn");
    throw new Error("no session");
  }
}

/** Messaging actions **/
el("btnSendText").addEventListener("click", async () => {
  try {
    requireSession();
    const to = el("t_to").value.trim();
    const text = el("t_text").value;
    const mentions = el("t_mentions").value.trim()
      ? el("t_mentions")
          .value.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    await api("/api/messages/text", "POST", {
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
    requireSession();
    const to = el("m_to").value.trim();
    const mediaType = el("m_type").value;
    const mediaUrl = el("m_url").value.trim();
    const caption = el("m_caption").value;
    await api("/api/messages/media", "POST", {
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
    requireSession();
    const to = el("loc_to").value.trim();
    const lat = parseFloat(el("loc_lat").value);
    const lng = parseFloat(el("loc_lng").value);
    const name = el("loc_name").value;
    const address = el("loc_addr").value;
    await api("/api/messages/location", "POST", {
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
    requireSession();
    const to = el("b_to").value.trim();
    const text = el("b_text").value;
    const footer = el("b_footer").value;
    const btns = [el("b_btn1").value, el("b_btn2").value, el("b_btn3").value]
      .map((t, i) =>
        t?.trim() ? { id: `btn_${i + 1}`, text: t.trim() } : null
      )
      .filter(Boolean);
    await api("/api/messages/buttons", "POST", {
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
    requireSession();
    const to = el("l_to").value.trim();
    const title = el("l_title").value;
    const text = el("l_text").value;
    const footer = el("l_footer").value;
    const buttonText = el("l_buttonText").value || "Open";
    let sections = [];
    const raw = el("l_sections").value.trim();
    if (raw) sections = JSON.parse(raw);
    await api("/api/messages/list", "POST", {
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
    requireSession();
    const to = el("p_to").value.trim();
    const name = el("p_name").value;
    const selectableCount = parseInt(el("p_selectable").value) || 1;
    const options = el("p_options")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await api("/api/messages/poll", "POST", {
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
    requireSession();
    const to = el("s_to").value.trim();
    const imageUrl = el("s_imageUrl").value.trim();
    await api("/api/messages/sticker", "POST", {
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
    requireSession();
    const to = el("vc_to").value.trim();
    const contact = {
      fullName: el("vc_full").value,
      org: el("vc_org").value,
      phone: el("vc_phone").value,
      email: el("vc_email").value,
    };
    await api("/api/messages/vcard", "POST", {
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
    requireSession();
    const to = el("g_to").value.trim();
    const videoUrl = el("g_videoUrl").value.trim();
    const caption = el("g_caption").value;
    await api("/api/messages/gif", "POST", {
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

/** Health **/
el("btnHealth").addEventListener("click", async () => {
  try {
    const out = await api("/health");
    const badge = el("healthBadge");
    badge.innerText = out.status === "ok" ? "OK" : "WARN";
    badge.className = "badge " + (out.status === "ok" ? "ok" : "warn");
    toast("Health checked");
  } catch (e) {
    toast("Health error", "err");
  }
});
