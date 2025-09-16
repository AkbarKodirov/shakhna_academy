// airtable.js - client placeholders for server-side integration
async function uploadTestToServer({title, group, filename, content}) {
  try {
    const resp = await fetch('/api/upload_test', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ title, group, filename, content })
    });
    return resp.json ? await resp.json() : resp;
  } catch (err) {
    console.error('uploadTestToServer error', err);
    throw err;
  }
}

async function fetchMyUploadedTests(){
  try {
    const r = await fetch('/api/my_tests');
    if(!r.ok) return [];
    return await r.json();
  } catch(err) { console.error(err); return []; }
}

async function listPublicTests(){
  try {
    const r = await fetch('/api/public_tests');
    if(!r.ok) return [];
    return await r.json();
  } catch(err) { console.error(err); return []; }
}
