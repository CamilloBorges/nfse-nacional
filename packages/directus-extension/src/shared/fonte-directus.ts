import type { CertificadoAberto, CertificadoBruto, EmpresaNfse, FonteDeCertificado, InfoCertificado, ProvedorDeChave } from 'nfse-nacional-core';
import type { Contexto } from './tipos.js';
import { Buffer } from 'node:buffer';
import {
	abrirCertificado,
	cifrar,
	decifrar,
	diasParaVencer,
	ErroCertificado,
	mesmaRaizCnpj,
	situacaoDoCertificado,
	somenteDigitos,
} from 'nfse-nacional-core';
import { EMPRESAS } from './esquema.js';
import { ErroUsuario } from './repositorio-directus.js';

/**
 * Fonte de certificado "directus": o .pfx e a senha ficam cifrados (envelope) no campo
 * `certificado_cifrado`, que é `conceal` (mascarado em qualquer leitura pela API ou MCP).
 * Por isso a leitura e a gravação desse campo vão direto no banco.
 */
export class FonteDirectus implements FonteDeCertificado {
	constructor(
		private readonly ctx: Contexto,
		private readonly provedor: ProvedorDeChave,
	) {}

	async obter(empresa: EmpresaNfse): Promise<CertificadoBruto> {
		const linha = await this.ctx.database(EMPRESAS).where({ id: empresa.id }).first('certificado_cifrado');
		if (!linha?.certificado_cifrado) throw new ErroUsuario('Nenhum certificado enviado para esta empresa.');
		const chave = await this.provedor.obterChaveMestra();
		const { pfx, senha } = JSON.parse(decifrar(linha.certificado_cifrado, chave, contexto(empresa)).toString('utf8'));
		return { pfx: Buffer.from(pfx, 'base64'), senha };
	}

	/** Valida o .pfx, cifra e guarda. Devolve só os metadados; a troca fica no log de atividades. */
	async salvar(empresa: EmpresaNfse, pfx: Buffer, senha: string, accountability: unknown): Promise<InfoCertificado> {
		let certificado: CertificadoAberto;

		try {
			certificado = abrirCertificado(pfx, senha);
		}
		catch (erro) {
			throw new ErroUsuario(erro instanceof ErroCertificado ? erro.message : 'Arquivo de certificado inválido.');
		}

		if (!certificado.cnpj) throw new ErroUsuario('Não encontrei o CNPJ no certificado. Use um e-CNPJ A1.');

		if (!mesmaRaizCnpj(certificado.cnpj, empresa.cnpj)) {
			throw new ErroUsuario(`O certificado é do CNPJ ${certificado.cnpj}, que não tem a mesma raiz de ${empresa.cnpj}.`);
		}

		const dias = diasParaVencer(certificado);
		if (dias < 0) throw new ErroUsuario('O certificado já está vencido.');

		const chave = await this.provedor.obterChaveMestra();
		const segredo = cifrar(Buffer.from(JSON.stringify({ pfx: pfx.toString('base64'), senha })), chave, contexto(empresa));
		await this.ctx.database(EMPRESAS).where({ id: empresa.id }).update({ certificado_cifrado: segredo });

		const empresas = new this.ctx.services.ItemsService(EMPRESAS, { schema: await this.ctx.getSchema(), accountability });

		await empresas.updateOne(empresa.id, {
			origem_certificado: 'directus',
			certificado_titular: certificado.titular,
			certificado_validade: certificado.validoAte.toISOString(),
			certificado_impressao_digital: certificado.impressaoDigital,
			situacao: situacaoDoCertificado(dias),
			ultimo_erro: null,
		});

		const { titular, cnpj, validoDe, validoAte, impressaoDigital } = certificado;
		return { titular, cnpj, validoDe, validoAte, impressaoDigital };
	}
}

/** Amarra o segredo à empresa: copiado para outro registro, não decifra. */
function contexto(empresa: EmpresaNfse): string {
	return `nfse-nacional:${somenteDigitos(empresa.cnpj)}`;
}
