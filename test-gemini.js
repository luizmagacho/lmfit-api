async function test() {
  const msgRes = await fetch(`http://127.0.0.1:4000/webhooks/whatsapp/kivoni`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'test',
        changes: [{
          value: {
            messages: [{
              from: '5511988880001',
              id: 'wamid.HBgLNTUxMTk4MzE5MzY1FQIAEhgWM0VCMEIwRjBGQkFDMDU0REFEQkQAA',
              type: 'text',
              text: { body: 'vendi 2 camiseta preta m por 100 reais' }
            }],
            metadata: { display_phone_number: '123', phone_number_id: '123' }
          }
        }]
      }]
    })
  });
  console.log(msgRes.status);
}

test().catch(console.error);
