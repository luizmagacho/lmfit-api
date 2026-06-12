const fs = require('fs');

// Patch AuthService
let authSvc = fs.readFileSync('src/auth/auth.service.ts', 'utf8');
authSvc = authSvc.replace(
  'async login(email: string, password: string) {',
  'async login(tenantId: string, email: string, password: string) {'
);
authSvc = authSvc.replace(
  'const user = await this.users.findByEmail(undefined, email);',
  'const user = await this.users.findByEmail(tenantId, email);'
);
fs.writeFileSync('src/auth/auth.service.ts', authSvc);

// Patch AuthController
let authCtrl = fs.readFileSync('src/auth/auth.controller.ts', 'utf8');
authCtrl = authCtrl.replace(
  "import { LoginDto } from './dto/login.dto';",
  "import { LoginDto } from './dto/login.dto';\nimport { TenantId } from '../common/decorators/tenant-id.decorator';"
);
authCtrl = authCtrl.replace(
  'login(@Body() dto: LoginDto) {',
  'login(@TenantId() tenantId: string, @Body() dto: LoginDto) {'
);
authCtrl = authCtrl.replace(
  'return this.auth.login(dto.email, dto.password);',
  'return this.auth.login(tenantId, dto.email, dto.password);'
);
fs.writeFileSync('src/auth/auth.controller.ts', authCtrl);

