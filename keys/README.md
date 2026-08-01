# Keys directory

- `public_key.pem` — ship with the CMS backend (used to verify `.lic`)
- `private_key.pem` — **Admin only**. Never deploy with the CMS app.

Generate:

```bash
python admin_tool_keygen.py gen-keys --out-dir keys
```
