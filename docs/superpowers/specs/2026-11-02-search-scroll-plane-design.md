# Buscar: chrome e resultados no mesmo plano de scroll

Data: 2026-11-02
Status: aprovado em conversa (aguardando revisão do arquivo antes do plano)

## Objetivo

Na aba `/buscar`, barra de pesquisa, chips, filtros e resultados (mosaico ou feed) passam a viver no mesmo fluxo de scroll, com o mesmo fundo. O flick rápido ou lento percorre o anúncio até o fim, inclusive quando a busca devolve um único item.

## Problema atual

Hoje o chrome fica em `.search-head` (flex irmão, fora de `.search-body`):

- Fundo próprio, `border-bottom` e `z-index` separam visualmente a barra do feed.
- `onBodyScroll` desmonta `.search-head-tools` (`toolsOpen`) quando `scrollTop > 48`.
- Com pouco conteúdo (1 anúncio), esconder a barra aumenta a altura do body, o `scrollTop` cai a 0, a barra reaparece e a tela treme / volta ao topo.

## Fora de escopo

- Não muda API, ranking de oficiais, Início, Catiras nem a ficha do anúncio.
- Não muda o card do mosaico nem o card do feed.
- Não muda posição do `VoiceFab` (continua `position: fixed` acima da nav).
- Não deixa a barra sticky nem reimplementa auto-hide por transform.
- Não remove filtros, busca por voz, banner, paginação nem o toggle mosaico/feed.

## Comportamento

### Um só overflow

- Logo, cidade, conta, toggle mosaico/feed, `SearchBox`, chips, painel de filtros, banner, lista e “Ver mais” ficam **dentro** do mesmo container com `overflow: auto` (o atual `.search-body`, ou `.search-screen` se o head deixar de ser irmão).
- Remover `toolsOpen`, `lastScroll` e `onBodyScroll`. A barra não some no scroll.
- Chip **Filtros** continua abrindo/fechando o painel; o painel **expande o fluxo** e sobe junto. Tirar `max-height: 40vh; overflow: auto` desse painel na Buscar (hoje em `.search-head .filters`), para não criar um segundo scroll.

### Mesmo plano visual

- Sem bloco de cabeçalho com `border-bottom` / fundo distinto que isole a barra do feed.
- Padding e cor iguais aos do feed (`var(--bg)`). Toggle e chips mantêm o visual atual (segmento e chips), só deixam de parecer um painel colado no topo.

### Scroll

- Flick rápido ou lento chega ao fim do anúncio e ao overscroll/fim de feed.
- Com 1 resultado, o conteúdo (chrome + card) é mais alto que a viewport; o usuário sobe o anúncio inteiro sem snap de `scrollTop`.
- Nav inferior e `VoiceFab` continuam fixos. Padding inferior do scroller (`--nav-h` + safe area) permanece.

### O que não muda

- Query, filtros, `localStorage` `catira.searchView`, paginação, comentários, avisos, denúncia.
- Tocar Mosaico/Feed não reseta o scroll além do re-render natural da lista.

## Arquivos

- `frontend/src/pages/Search.jsx`: mover o chrome para o scroller; apagar estado e handler de auto-hide.
- `frontend/src/styles.css`: unificar plano (sem `.search-head` separado, ou esvaziar o papel dele); filtros da Buscar sem scroll interno.

## Testes / verificação

Não há teste de componente React da Buscar. Critério manual:

1. `/buscar` sem termo: barra e mosaico no mesmo fundo; scroll único.
2. Busca que devolve 1 item: flick rápido e lento percorrem o card até o fim, sem tremer nem voltar ao topo.
3. Chip Filtros abre o painel no mesmo fluxo; o scroller da página é o único.
4. Toggle mosaico/feed, voz e “Ver mais” seguem iguais.

## Critério de pronto

- Não existe auto-hide da barra na Buscar.
- Chrome e resultados compartilham o mesmo overflow e o mesmo fundo.
- 1 resultado não provoca jump/shake no flick.
- Filtros, voz, banner, paginação e toggle intactos.
