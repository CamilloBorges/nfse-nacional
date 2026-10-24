import { defineModule } from '@directus/extensions-sdk';
import Pagina from './pagina.vue';

export default defineModule({
	id: 'nfse-nacional',
	name: 'NFS-e Nacional',
	icon: 'receipt_long',
	routes: [{ path: '', component: Pagina }],
	// Só administradores veem o módulo; as rotas de API também exigem admin.
	preRegisterCheck: (user: any) => user?.admin_access === true || user?.role?.admin_access === true,
});
