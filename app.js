// app.js — basic Airtable-powered frontend logic
var app = (function(){
  const cfg = window.SH_CONFIG;
  const baseUrl = `https://api.airtable.com/v0/${cfg.AIRTABLE_BASE_ID}`;
  const headers = {
    Authorization: 'Bearer ' + cfg.AIRTABLE_TOKEN,
    'Content-Type': 'application/json'
  };

  // === Assign Tests table names ===
const TABLES = {
  ASSIGN_TESTS: (window.SH_CONFIG?.ASSIGN_TESTS_TABLE) || 'Assign_Tests',
  TEST_RESULTS: (window.SH_CONFIG?.TEST_RESULTS_TABLE) || 'Test_Results'
};


  // Basic helpers
  async function airtableList(table, filterFormula='') {
    let url = baseUrl + '/' + encodeURIComponent(table) + '?pageSize=100';
    if(filterFormula) url += '&filterByFormula=' + encodeURIComponent(filterFormula);
    const res = await fetch(url, {headers});
    if(!res.ok) throw new Error('Airtable list error: ' + res.status);
    const data = await res.json();
    return data.records || [];
  }

  async function airtableCreate(table, fields) {
  const url = `${baseUrl}/${encodeURIComponent(table)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ fields }) // airtable expects { "fields": {...} }
  });

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error('Airtable create: invalid JSON response', err);
    throw new Error('Invalid response from Airtable');
  }

  if (!res.ok) {
    // log Airtable error details to console for debugging
    console.error(`Airtable Create Error [${res.status}]`, data);
    throw new Error(data?.error?.message || `Airtable create failed [${res.status}]`);
  }

  return data;
}


  async function updateAirtableRecord(table, recordId, fields) {
    const url = `${baseUrl}/${encodeURIComponent(table)}/${recordId}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields })
    });
    if (!res.ok) throw new Error('Airtable update error: ' + res.status);
    const data = await res.json();
    return data;
  }

  // Auth (very simple: match email + password stored in Users table)
  async function register({email,password}) {
    const payload = {Email: email, Password: password, Role: 'Student', Name: email.split('@')[0]};
    const created = await airtableCreate(cfg.USERS_TABLE, payload);
    if(created) {
      localStorage.setItem('sh_user', JSON.stringify(created));
      window.location.href = 'dashboard.html';
      return true;
    }
    return false;
  }

  // === Modal Helpers ===
function openModal(el) {
  if (el) {
    el.style.display = 'block';
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(el) {
  if (el) {
    el.style.display = 'none';
    document.body.style.overflow = '';
  }
}


  async function login({email,password}) {
    try{
      const filter = `AND( {Email} = "${email}", {Password} = "${password}" )`;
      const rows = await airtableList(cfg.USERS_TABLE, filter);
      if(rows.length === 0){ document.getElementById('loginMsg').textContent = 'Invalid credentials'; return null; }
      const user = rows[0];
      localStorage.setItem('sh_user', JSON.stringify(user));
      if(user.fields.Role && user.fields.Role.toLowerCase() === 'teacher') window.location.href = 'teacher.html';
      else window.location.href = 'dashboard.html';
      return user;
    } catch(e){ console.error(e); document.getElementById('loginMsg').textContent = 'Error logging in'; return null; }
  }

  function logout(){
    localStorage.removeItem('sh_user');
    window.location.href = 'login.html';
  }

  async function getCurrentUser(){
    const raw = localStorage.getItem('sh_user');
    if(!raw) return null;
    try { return JSON.parse(raw); } catch(e){ return null; }
  }

  function protectRoute(){
    const raw = localStorage.getItem('sh_user');
    if(!raw) window.location.href = 'login.html';
  }

  async function renderStudentHomeworks(user){
    try{
      const email = user.fields.Email;
      const filter = `({studentEmail} = "${email}")`;
      const records = await airtableList(cfg.HOMEWORKS_TABLE, filter);
      const tbody = document.querySelector('#hwTable tbody');
      if(!tbody) return;
      tbody.innerHTML = records.map(r=>`<tr>
        <td>${r.fields.subject||''}</td>
        <td>${r.fields.title||''}</td>
        <td>${r.fields.due_date||''}</td>
        <td><input type="checkbox" data-id="${r.id}" ${r.fields.done?'checked':''}></td>
      </tr>`).join('');
      tbody.querySelectorAll('input[type=checkbox]').forEach(ch=>{
        ch.addEventListener('change', async e=>{
          const rid = e.target.dataset.id;
          const done = e.target.checked;
          await fetch(baseUrl + '/' + cfg.HOMEWORKS_TABLE + '/' + rid, {method:'PATCH', headers, body: JSON.stringify({fields:{done}})});
        });
      });
    }catch(e){ console.error(e); }
  }

  async function renderStudentsList(){
    try{
      const students = await airtableList(cfg.USERS_TABLE);
      const tbody = document.querySelector('#studentsTable tbody');
      if(!tbody) return;
      tbody.innerHTML = students.map(s=>`<tr><td>${s.fields.Name||''}</td><td>${s.fields.Email||''}</td><td>${s.fields.Role||''}</td></tr>`).join('');
    }catch(e){ console.error(e); }
  }

  async function createHomework({subject, title, details, studentEmail, due_date, files=[]}) {
  try {
    const attachments = files.map(file => ({
      url: file.url,        // Cloudinary public URL
      filename: file.filename
    }));

    const fields = { subject, title, details, studentEmail, due_date };
    if (attachments.length) fields.Attachments = attachments;

    const res = await airtableCreate(cfg.HOMEWORKS_TABLE, fields);
    return !!res;
  } catch (e) {
    console.error(e);
    return false;
  }
}

async function uploadHomeworkFile(file) {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('http://localhost:3000/api/upload_homework', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data?.error || 'Upload failed');

    return { url: data.publicUrl, filename: file.name };
  } catch (err) {
    console.error('❌ Failed to upload file:', err);
    return null;
  }
}


  async function renderGroupOptions() {
    try {
      const groups = await airtableList("Groups");
      const groupSelect = document.getElementById("hwGroup");

      if (!groupSelect) return;

      groupSelect.innerHTML = '<option value="">Select a group</option>';

      groups.forEach(group => {
        const name = group.fields["Name"];
        if (name) {
          const option = document.createElement("option");
          option.value = group.id;
          option.textContent = name;
          groupSelect.appendChild(option);
        }
      });

      console.log("✅ Groups loaded:", groups);
    } catch (e) {
      console.error("Error fetching groups:", e);
    }
  }

  async function uploadTest({title, group, filename, content}){
    try {
      const serverUrl = 'http://localhost:3000/api/upload_test';
      const res = await fetch(serverUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({title, group, filename, content})
      });
      if (!res.ok) throw new Error('Upload error');
      const data = await res.json();
      return data;
    } catch(e) {
      console.error(e);
      return null;
    }
  }

  // === Load all HTML tests from /tests/ folder dynamically ===
async function loadAvailableTests() {
  const select = document.getElementById("testSelect");
  if (!select) return;

  try {
    // Fetch the list of tests from /tests/ folder
    const res = await fetch("./tests/");
    const html = await res.text();

    // Extract .html files from the folder index
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const links = Array.from(doc.querySelectorAll("a"))
      .map(a => a.href)
      .filter(href => href.endsWith(".html"));

    if (links.length === 0) {
      select.innerHTML = '<option value="">No tests available</option>';
      return;
    }

    // Populate dropdown with available tests
    select.innerHTML = '<option value="">Select a test</option>';
    links.forEach(link => {
      const fileName = link.split("/").pop();
      select.innerHTML += `<option value="./tests/${fileName}">${fileName}</option>`;
    });
  } catch (err) {
    console.error("Error loading tests:", err);
    select.innerHTML = '<option value="">Failed to load tests</option>';
  }
}


// === Render Tests Panel ===
async function renderTestsPanel() {
  try {
    const [groups, tests] = await Promise.all([
      airtableList(cfg.GROUPS_TABLE),
      airtableList(TABLES.ASSIGN_TESTS)
    ]);

    // Fill dropdown in Assign Modal
    const groupSelect = document.getElementById("testGroup");
    if (groupSelect) {
      groupSelect.innerHTML = '<option value="">Select a group</option>' +
        groups.map(g => `<option value="${g.id}">${g.fields.Name || 'Unnamed'}</option>`).join('');
    }

    // Draw grid of tests
    const grid = document.getElementById('testsGrid');
    if (!grid) return;

    if (!tests || tests.length === 0) {
      grid.innerHTML = `<div class="card" style="text-align:center;">No tests yet. Click “Assign Test”.</div>`;
      return;
    }

    const today = new Date();
    grid.innerHTML = tests.map(t => {
      const groupId = t.fields.Group?.[0];
      const groupName = groups.find(g => g.id === groupId)?.fields.Name || t.fields.GroupName || 'Unknown group';
      const due = t.fields['Due Date'] || '';
      const dueTxt = due ? new Date(due).toLocaleDateString() : '-';
      const isExpired = due && new Date(due) < today;
      const statusClass = isExpired ? 'expired' : 'active';
      const statusText = isExpired ? 'Expired' : 'Active';

      return `
        <div class="test-card">
          <div>
            <h4>${t.fields.Title || 'Untitled Test'}</h4>
            <div class="test-meta">
              <span>Group: ${groupName}</span>
              <span>Due: ${dueTxt}</span>
              <span class="status ${statusClass}">${statusText}</span>
            </div>
          </div>
          <div class="actions">
            <button class="view-btn" data-id="${t.id}">View</button>
          </div>
        </div>
      `;
    }).join('');

    // Attach event listeners to "View" buttons
    grid.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const test = tests.find(t => t.id === btn.dataset.id);
    const groupId = test.fields.Group?.[0];  // ✅ Correct group ID
    const title = test.fields.Title || 'Untitled Test';
    openStatsForTest(test.id, title, groupId); // ✅ Pass all required data
  });
});


  } catch (err) {
    console.error("Error loading tests:", err);
  }
}



//document.addEventListener
document.addEventListener("DOMContentLoaded", async () => {
  const testsNav = document.getElementById("testsNav");
  const testsPanel = document.getElementById("testsPanel");
  const assignBtn  = document.getElementById("assignTestBtn");
  const assignModal = document.getElementById("assignModal");
  const statsModal  = document.getElementById("statsModal");
  const assignForm  = document.getElementById("assignTestForm");

  // Open tests panel
  if (testsNav && testsPanel) {
    testsNav.addEventListener("click", async (e) => {
      e.preventDefault();
      document.querySelectorAll(".container").forEach(c => c.style.display = "none");
      testsPanel.style.display = "block";
      await renderTestsPanel();
    });
  }

  // Assign Modal Open/Close
if (assignBtn && assignModal) {
  assignBtn.addEventListener("click", () => {
    loadAvailableTests();  // ✅ Dynamically load tests into dropdown
    openModal(assignModal); // ✅ Then open modal
  });

  assignModal.querySelector(".close")?.addEventListener("click", () => closeModal(assignModal));
  assignModal.addEventListener("click", (e) => { 
    if (e.target === assignModal) closeModal(assignModal);
  });
}


  // Stats Modal Close
  if (statsModal) {
    statsModal.querySelector(".close")?.addEventListener("click", () => closeModal(statsModal));
    statsModal.addEventListener("click", (e) => { if (e.target === statsModal) closeModal(statsModal); });
  }

  // Handle Assign Form Submit
  if (assignForm) {
    assignForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("testTitle").value.trim();
  const selectedTest = document.getElementById("testSelect").value;
  const group = document.getElementById("testGroup").value;
  const due = document.getElementById("testDue").value;

  if (!title || !selectedTest || !group || !due) {
    alert("Please fill in all fields.");
    return;
  }

  try {
    await airtableCreate(TABLES.ASSIGN_TESTS, {
  "Test Title": title,
  "Test File": [
    {
      url: selectedTest   // Store test URL as attachment
    }
  ],
  Group: [group],
  "Due Date": due
});

    closeModal(assignModal);
    assignForm.reset();
    await renderTestsPanel();
  } catch (err) {
    console.error(err);
    alert("Failed to save test. Check console.");
  }
});

  }
});

async function openStatsForTest(testId, testTitle, groupId) {
  const statsModal = document.getElementById("statsModal");
  const statsContent = document.getElementById("statsContent");

  statsContent.innerHTML = "<p>Loading statistics...</p>";
  statsModal.style.display = "block";

  try {
    // ✅ 1. Fetch group details directly from Groups table
    const groupRes = await fetch(
      `https://api.airtable.com/v0/${window.SH_CONFIG.AIRTABLE_BASE_ID}/${window.SH_CONFIG.GROUPS_TABLE}/${groupId}`,
      {
        headers: { Authorization: `Bearer ${window.SH_CONFIG.AIRTABLE_TOKEN}` },
      }
    );

    if (!groupRes.ok) {
      throw new Error(`Failed to fetch group: ${groupRes.status}`);
    }

    const groupData = await groupRes.json();

    // ✅ 2. Get students directly from linked "Users" field in Groups table
    const linkedStudentIds = groupData.fields.Users || [];
    const allStudentsCount = linkedStudentIds.length;

    // ✅ 3. Fetch full student names
    const studentRecords = await Promise.all(
      linkedStudentIds.map(async id => {
        const res = await fetch(
          `https://api.airtable.com/v0/${window.SH_CONFIG.AIRTABLE_BASE_ID}/${window.SH_CONFIG.USERS_TABLE}/${id}`,
          { headers: { Authorization: `Bearer ${window.SH_CONFIG.AIRTABLE_TOKEN}` } }
        );
        if (!res.ok) return { id, fields: { Name: "Unnamed Student" } };
        return res.json();
      })
    );

    // ✅ 4. Fetch test results for this test
    const resultsRes = await fetch(
      `https://api.airtable.com/v0/${window.SH_CONFIG.AIRTABLE_BASE_ID}/${TABLES.TEST_RESULTS}?filterByFormula=${encodeURIComponent(`SEARCH("${testId}", ARRAYJOIN({Test}))`)}`,
      {
        headers: { Authorization: `Bearer ${window.SH_CONFIG.AIRTABLE_TOKEN}` },
      }
    );

    if (!resultsRes.ok) {
      throw new Error(`Failed to fetch results: ${resultsRes.status}`);
    }

    const resultsData = await resultsRes.json();
    const completedIds = resultsData.records
      .filter(r => r.fields.Status === "Completed")
      .map(r => r.fields.Student?.[0]);

    // ✅ 5. Split students into completed & pending
    const completedStudents = studentRecords.filter(s => completedIds.includes(s.id));
    const pendingStudents = studentRecords.filter(s => !completedIds.includes(s.id));

    // ✅ 6. Render statistics in old style
    statsContent.innerHTML = `
      <h3>${testTitle}</h3>
      <p><b>Total Students:</b> ${allStudentsCount}</p>
      <p style="color:green;"><b>Completed:</b> ${completedStudents.length}</p>
      <p style="color:red;"><b>Pending:</b> ${pendingStudents.length}</p>

      <div style="margin-top:10px;">
        <h4>✅ Completed Students:</h4>
        <ul>${completedStudents.map(s => `<li>${s.fields.Name}</li>`).join("") || "<li>None yet</li>"}</ul>

        <h4>⏳ Pending Students:</h4>
        <ul>${pendingStudents.map(s => `<li>${s.fields.Name}</li>`).join("") || "<li>Everyone completed</li>"}</ul>
      </div>
    `;
  } catch (err) {
    console.error("❌ Failed to fetch stats:", err);
    statsContent.innerHTML = "<p style='color:red;'>Failed to load statistics.</p>";
  }
}

// === Render Student Payments ===
  // === Render Student Payments ===
async function renderStudentPayments(user) {
  const paymentsTable = document.querySelector("#studentPayments tbody");
  if (!paymentsTable) return;

  paymentsTable.innerHTML = "";
  const months = ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const today = new Date();

  const payments = await airtableList(cfg.PAYMENTS_TABLE);
  const groups = await airtableList(cfg.GROUPS_TABLE);

  const studentId = user.id;
  const studentGroupId = user.fields.Group?.[0];
  const group = groups.find(g => g.id === studentGroupId);

  let startDate = group?.fields["Start Date"]
    ? new Date(group.fields["Start Date"])
    : new Date(today.getFullYear(), 8, 1); // default 1 Sep

  let hasUnpaid = false;

  months.forEach((month, i) => {
    let dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);

    // only show months up to current
    if (dueDate > today) return;

    const payment = payments.find(p =>
      p.fields.Student?.[0] === studentId &&
      p.fields.Month?.trim().toLowerCase() === month.toLowerCase()
    );

    let statusClass = "";
    let statusText = "";

    if (payment && payment.fields.Status === "Paid") {
      statusClass = "paid";
      statusText = "✅ Paid";
    } else {
      statusClass = "unpaid";
      statusText = "❌ Unpaid";
      hasUnpaid = true;
    }

    paymentsTable.innerHTML += `
      <tr>
        <td>${month}</td>
        <td class="${statusClass}">${statusText}</td>
        <td>${dueDate.toISOString().split("T")[0]}</td>
      </tr>
    `;
  });

  // Add warning row if unpaid exists
  if (hasUnpaid) {
    paymentsTable.innerHTML += `
      <tr>
        <td colspan="3" style="color:red; font-weight:bold; text-align:center;">
          ⚠️ You have unpaid months. Please complete payment.
        </td>
      </tr>
    `;
  }
}


  // === Render Student Homeworks ===
// === Render Student Homeworks from Groups table (Updated with Row Cue Card Design and View Expansion) ===
// === Render Student Homeworks ===
async function renderStudentHomeworks(user) {
  const container = document.querySelector("#hwContainer");
  if (!container) return;

  container.innerHTML = "<p>Loading homeworks...</p>";

  const groupId = user.fields.groupId?.[0];
  if (!groupId) {
    container.innerHTML = `<p>No group linked to your account</p>`;
    return;
  }

  try {
    // Fetch group data
    const groupRes = await fetch(
      `https://api.airtable.com/v0/${window.SH_CONFIG.AIRTABLE_BASE_ID}/${window.SH_CONFIG.GROUPS_TABLE}/${groupId}`,
      { headers: { Authorization: `Bearer ${window.SH_CONFIG.AIRTABLE_TOKEN}` } }
    );

    if (!groupRes.ok) throw new Error(`Failed to fetch group: ${groupRes.status}`);
    const groupData = await groupRes.json();

    const homeworkIds = groupData.fields.Homeworks || [];
    if (!homeworkIds.length) {
      container.innerHTML = `<p>No homework assigned</p>`;
      return;
    }

    // Fetch all homework records
    const homeworkRecords = await Promise.all(
      homeworkIds.map(async id => {
        const res = await fetch(
          `https://api.airtable.com/v0/${window.SH_CONFIG.AIRTABLE_BASE_ID}/${window.SH_CONFIG.HOMEWORKS_TABLE}/${id}`,
          { headers: { Authorization: `Bearer ${window.SH_CONFIG.AIRTABLE_TOKEN}` } }
        );
        if (!res.ok) return null;
        return res.json();
      })
    );

    const homeworks = homeworkRecords.filter(Boolean);
    if (!homeworks.length) {
      container.innerHTML = `<p>No homework assigned</p>`;
      return;
    }

    // Sort by due date (newest first)
    homeworks.sort((a,b) => new Date(b.fields["Due Date"]) - new Date(a.fields["Due Date"]));

    const today = new Date();

    // Render cards
    container.innerHTML = `
      <div class="homework-grid">
        ${homeworks.map(hw => {
          const dueDate = hw.fields["Due Date"] || '';
          const dueTxt = dueDate ? new Date(dueDate).toLocaleDateString() : '-';
          const isExpired = dueDate && new Date(dueDate) < today;
          const attachments = hw.fields.Attachments || [];
          const attachmentsSafe = encodeURIComponent(JSON.stringify(attachments));

          return `
            <div class="cue-card" data-hwid="${hw.id}" data-desc="${hw.fields.Description || 'No full description'}" data-attachments="${attachmentsSafe}">
              <div class="cue-card-header">${hw.fields.Title || "Untitled Homework"}</div>
              <div class="cue-card-content">
                <p>${(hw.fields.Description || "No details provided").substring(0,100)}...</p>
                <div class="meta">
                  <span><strong>Group:</strong> Intensive Masters</span>
                  <span><strong>Due:</strong> ${dueTxt}</span>
                  <span class="status ${isExpired ? 'expired' : 'active'}">${isExpired ? 'Overdue' : 'Active'}</span>
                </div>
                <button class="view-btn">View</button>
                <div class="attachmentsContainer" style="margin-top:10px;"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Add click listeners for View buttons
    container.querySelectorAll(".cue-card .view-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        const card = e.target.closest(".cue-card");
        expandHomework(card);
      });
    });

  } catch (err) {
    console.error("❌ Error loading homeworks:", err);
    container.innerHTML = `<p style='color:red;'>Failed to load homeworks</p>`;
  }
}

// === Expand Homework ===
function expandHomework(card) {
  collapseHomework(); // Collapse any previously expanded

  card.classList.add("expanded");

  // Hide other cards
  document.querySelectorAll('.cue-card').forEach(c => {
    if(c !== card) c.classList.add('hidden');
  });

  const fullDesc = card.dataset.desc;
  let attachments = [];
  try {
    attachments = JSON.parse(decodeURIComponent(card.dataset.attachments));
  } catch(e) {
    console.error("Failed to parse attachments:", e);
  }

  const container = card.querySelector(".attachmentsContainer");
  container.innerHTML = '';

  if (attachments.length > 0) {
    attachments.forEach(file => {
      const link = document.createElement('a');
      link.href = file.url;
      link.target = "_blank";
      link.textContent = file.filename;
      link.style.display = "block";
      container.appendChild(link);
    });
  } else {
    container.innerHTML = '<p>No attachments</p>';
  }

  // Replace content with full description + Back button
  const contentEl = card.querySelector(".cue-card-content");
  const metaEl = contentEl.querySelector(".meta").outerHTML;
  contentEl.innerHTML = `
    <p>${fullDesc}</p>
    ${metaEl}
    <div class="attachmentsContainer" style="margin-top:10px;"></div>
    <button class="back-btn">← Back</button>
  `;
  const backBtn = contentEl.querySelector(".back-btn");
  backBtn.addEventListener("click", collapseHomework);

  // Re-add attachments
  const attachmentsContainer = contentEl.querySelector(".attachmentsContainer");
  if (attachments.length > 0) {
    attachments.forEach(file => {
      const link = document.createElement('a');
      link.href = file.url;
      link.target = "_blank";
      link.textContent = file.filename;
      link.style.display = "block";
      attachmentsContainer.appendChild(link);
    });
  } else {
    attachmentsContainer.innerHTML = '<p>No attachments</p>';
  }
}

// === Collapse Homework ===
function collapseHomework() {
  const expandedCard = document.querySelector('.cue-card.expanded');
  if (!expandedCard) return;

  expandedCard.classList.remove('expanded');
  document.querySelectorAll('.cue-card').forEach(c => c.classList.remove('hidden'));

  // Re-render original card content
  const desc = expandedCard.dataset.desc;
  const attachmentsSafe = expandedCard.dataset.attachments;
  const attachments = JSON.parse(decodeURIComponent(attachmentsSafe));

  const contentEl = expandedCard.querySelector(".cue-card-content");
  const dueTxt = expandedCard.querySelector('.meta span:nth-child(2)').textContent;
  const statusEl = expandedCard.querySelector('.status');
  const statusClass = statusEl.classList.contains('expired') ? 'expired' : 'active';
  const statusText = statusEl.textContent;

  contentEl.innerHTML = `
    <p>${desc.substring(0,100)}...</p>
    <div class="meta">
      <span><strong>Group:</strong> Intensive Masters</span>
      <span><strong>Due:</strong> ${dueTxt}</span>
      <span class="status ${statusClass}">${statusText}</span>
    </div>
    <button class="view-btn">View</button>
    <div class="attachmentsContainer" style="margin-top:10px;"></div>
  `;

  // Reattach click for View button
  contentEl.querySelector('.view-btn').addEventListener('click', e => {
    expandHomework(expandedCard);
  });

  // Reattach attachments
  const attachmentsContainer = contentEl.querySelector(".attachmentsContainer");
  if (attachments.length > 0) {
    attachments.forEach(file => {
      const link = document.createElement('a');
      link.href = file.url;
      link.target = "_blank";
      link.textContent = file.filename;
      link.style.display = "block";
      attachmentsContainer.appendChild(link);
    });
  } else {
    attachmentsContainer.innerHTML = '<p>No attachments</p>';
  }
}

  // === Render Student Tests ===
  async function renderStudentTests(user) {
    const table = document.querySelector("#testsTable tbody");
    if (!table) return;

    table.innerHTML = "";
    const groupId = user.fields.Group?.[0];
    if (!groupId) {
      table.innerHTML = `<tr><td colspan="3">No tests assigned</td></tr>`;
      return;
    }

    const tests = await airtableList(TABLES.ASSIGN_TESTS, `SEARCH("${groupId}", ARRAYJOIN({Group}))`);
    if (!tests.length) {
      table.innerHTML = `<tr><td colspan="3">No tests assigned</td></tr>`;
      return;
    }

    tests.forEach(test => {
      const due = test.fields["Due Date"] || "-";
      const status = new Date(due) < new Date() ? "Expired" : "Upcoming";
      table.innerHTML += `
        <tr>
          <td>${test.fields.Title || "Untitled"}</td>
          <td>${due}</td>
          <td>${status}</td>
        </tr>
      `;
    });
  }

  // === Export everything ===
  return {
    register,
    login,
    logout,
    getCurrentUser,
    protectRoute,
    airtableList,
    airtableCreate,
    updateAirtableRecord,
    renderGroupOptions,
    createHomework,
    uploadHomeworkFile,
    uploadTest,
    renderStudentsList,
    renderStudentPayments,
    renderStudentHomeworks,
    renderStudentTests
  };
})();
console.log('app.js loaded successfully', app);
