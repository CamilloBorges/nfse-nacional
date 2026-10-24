declare module '*.vue' {
	import type { DefineComponent } from 'vue';
	const componente: DefineComponent<object, object, any>;
	export default componente;
}
