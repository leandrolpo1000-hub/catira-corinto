import { money } from '../api';
import { Top } from '../components';
import { useConfig } from '../config';

export function Privacy() {
  return (
    <>
      <Top back title="Privacidade" />
      <div className="page legal">
        <h1>Política de privacidade</h1>
        <p>
          O CATIRA é um classificado local de Corinto-MG. Coletamos apenas os dados necessários
          para cadastro, publicação de anúncios e contato entre usuários: nome, e-mail, telefone,
          cidade, senha e fotos enviadas no anúncio.
        </p>
        <p>
          Esses dados são usados para autenticar a conta, publicar anúncios, gerar o pagamento PIX
          da taxa de publicação e permitir conversas, propostas de troca e denúncias. Não vendemos
          seus dados a terceiros.
        </p>
        <p>
          Você pode pedir a exclusão da conta e dos anúncios. Fotos e textos publicados ficam
          visíveis enquanto o anúncio estiver no ar. Publicações do Catira em Ação (fotos e texto)
          também ficam visíveis enquanto estiverem no feed. Pagamentos da taxa de anúncio são
          registrados para controle administrativo.
        </p>
        <p>
          Os produtos anunciados são de responsabilidade exclusiva do usuário anunciante. O CATIRA
          não intermedia a entrega, não guarda mercadoria e não se responsabiliza pela qualidade,
          origem ou legalidade do item.
        </p>
      </div>
    </>
  );
}

export function Terms() {
  const { fee, feeEnabled } = useConfig();
  return (
    <>
      <Top back title="Termos de uso" />
      <div className="page legal">
        <h1>Termos de uso</h1>
        <p>
          Ao usar o CATIRA, você concorda em anunciar apenas itens de sua posse, com fotos reais
          e descrição verdadeira. É proibido publicar produtos ilegais, falsificados ou de origem
          duvidosa.
        </p>
        <p>
          Quem compra não paga taxa ao CATIRA.{' '}
          {feeEnabled
            ? `A publicação de anúncio custa ${money(fee)}, valor promocional até atingir o limite da cota preestabelecida. O anúncio só fica público após a confirmação do pagamento.`
            : 'A publicação de anúncio é gratuita.'}
        </p>
        <p>
          Os produtos anunciados são de responsabilidade exclusiva do usuário anunciante. O CATIRA
          é apenas o meio de divulgação. A negociação, o pagamento do item, a entrega e a troca
          ocorrem diretamente entre as partes.
        </p>
        <p>
          Não faça pagamentos antecipados para pessoas desconhecidas. Prefira negociar
          pessoalmente em locais seguros. Não compartilhe senhas ou códigos recebidos por SMS.
          Em caso de suspeita de golpe, denuncie o anúncio e bloqueie o usuário.
        </p>
        <p>
          A opção de proposta rápida e a Central de Repasse são de intermediação: o CATIRA
          avalia oportunidades e conecta vendedor a catireiros credenciados. Manifestar
          interesse não é compra, não gera cobrança e não transfere a mercadoria. O CATIRA
          não assume estoque nesse modelo. Compra e revenda própria só ocorre se estiver
          expressamente ativada pela administração e com documentação própria.
        </p>
        <p>
          O Catira em Ação é um mural de atividade: fotos e texto, sem preço e sem contato.
          Publicar é opcional, depois de marcar um anúncio como vendido, trocado ou negociado.
          Isso não prova a transação e não altera a reputação por estrelas.
        </p>
      </div>
    </>
  );
}
