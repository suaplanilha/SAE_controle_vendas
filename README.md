# SAE — Controle de Vendas da Planilha LEO

> **Status:** implementação inicial realizada após homologação de 05/09/2026.<br>
> **Implementação:** frontend Vue 3 e backend GAS conectados à aba homologada.

## 1. Visão do produto

O **SAE (Sistema Apollo Enterprise) — Controle de Vendas** será um Web App sobre
Google Apps Script e Google Sheets para registrar pedidos e transformar os
lançamentos em indicadores operacionais de faturamento, volume e comparação com
o mesmo dia da semana anterior.

O produto deve ser simples para a operação diária, responsivo em celular e
desktop, visualmente consistente com a identidade dark/glass do SAE e seguro
para publicação como Web App. A fonte oficial dos dados será a planilha informada
pelo usuário, com uma linha por lançamento operacional.

## 1.1 Decisões homologadas

- Aba oficial: `Leo_bd`.
- Timezone: `America/Sao_Paulo`.
- Pedidos: soma numérica da coluna `pedido`; cada linha é somente um lançamento.
  Valores zero permanecem visíveis nas tabelas e representam uma faixa registrada,
  mas não aumentam os indicadores.
- Web App: acesso público, executado como proprietário.
- Filtros: combinados por interseção.
- Série histórica: últimos 12 meses corridos.
- Comparador: data atual como padrão, com uma segunda opção selecionável.
- Consolidado mensal: uma linha por faixa horária.
- Spreadsheet ID: configurado no backend como
  `1nhN1q2NEkwJ5YZVuUMQVAofMEgBGixKKDEQORwHuAuc`.

## 1.2 Refinamentos visuais e operacionais

- Gráficos sem rótulos ou grades no eixo Y, com meses escritos como `maio/26` e
  séries mensais limitadas aos meses que possuem lançamentos.
- Gráficos diários e horários exibem valores fixos sobre as barras; faixas sem
  registros não são criadas, enquanto lançamentos reais com valor zero continuam
  visíveis.
- A troca entre Dashboard e Operações recria os gráficos após o DOM do Vue estar
  disponível, sem exigir novo clique em “Aplicar filtros”.
- A tabela recente não expõe o UUID visualmente e preserva lançamentos cuja quantidade de pedidos
  ou valor seja `0`.
- O horário final recebe automaticamente uma hora adicional após a seleção do
  horário inicial e continua editável.
- O atalho redundante da sidebar foi substituído por um botão flutuante azul. Em
  celulares, a navegação usa uma Tab Bar flutuante com glassmorphism.
- No modal, Cancelar usa vermelho, Salvar e novo usa azul e Salvar permanece verde.

## 2. Escopo confirmado pelo briefing

### 2.1 Dashboard

- Filtros navegáveis por mês, dia e faixa horária.
- KPIs de faturamento do dia, mês e acumulado do ano.
- KPIs de quantidade de pedidos do dia, mês e acumulado do ano.
- Para faturamento e pedidos:
  - evolução por mês em gráfico de linha;
  - resultado por dia do mês em gráfico de barras;
  - resultado por faixa horária do dia em gráfico de barras;
  - destaque visual dos três maiores resultados;
  - omissão de faixas sem lançamentos nos gráficos por horário.
- Atualização dos indicadores após cada operação persistida, sem recarregar a
  página inteira.

### 2.2 Comparador semanal e projeção

- Comparar o dia selecionado com a data exatamente sete dias anterior, que será
  o mesmo dia da semana.
- Agrupar a comparação por faixa `horario_inicio`–`horario_fim`.
- Para cada faixa, exibir pedidos na data de referência, pedidos na data atual,
  diferença para equiparar e estado (abaixo, igual ou acima).
- Permitir navegar pelas faixas futuras do dia e mostrar a quantidade de pedidos
  necessária para igualar a faixa equivalente da semana anterior.
- Não inventar meta quando a semana anterior não possuir base real; nesse caso,
  apresentar “Sem base comparativa”.

### 2.3 Operações

- Cabeçalho “Operações de lançamento” e ação “Novo pedido”.
- Modal com data (inicialmente a data atual, editável), hora inicial, hora final,
  valor e número do pedido.
- Ações “Salvar”, “Salvar e novo” e “Cancelar”; “Salvar e novo” persiste, limpa
  os campos adequados e mantém o modal aberto.
- Tabela paginada, ordenada do lançamento mais recente para o mais antigo, com
  20 registros por página.
- Tabela do mês atual com UUID, data, intervalo de horário agrupado, valor,
  pedido e ações de editar/excluir.
- Edição por UUID e exclusão somente após confirmação explícita.

## 3. Diagnóstico do repositório atual

### 3.1 O que pode ser reaproveitado conceitualmente

- A paleta solicitada, a navegação Dashboard/Operações e grande parte da
  composição visual já aparecem no HTML.
- O HTML já esboça KPIs, seis gráficos, comparação semanal, projeção, tabelas e
  modal.
- O backend já contém um CRUD inicial e a leitura da aba.

Esses elementos são somente uma referência visual/funcional. A implementação
deverá ser reorganizada antes de ser considerada pronta para produção.

### 3.2 Lacunas e riscos encontrados

| Área | Estado encontrado | Direção proposta |
| --- | --- | --- |
| Frontend obrigatório | JavaScript imperativo; Vue 3 não está carregado | Migrar o single-file para Vue 3 via CDN, com estado reativo e componentes locais |
| Dados | Dados de demonstração gerados no navegador e persistidos em `localStorage` | Remover mocks e usar exclusivamente `google.script.run` |
| Fonte da planilha | Uso de `SpreadsheetApp.getActiveSpreadsheet()` | Abrir pelo ID homologado no backend, evitando dependência de planilha ativa |
| Nome da aba | Código usa `Leo_bd`; briefing cita `Leo_db` e também `Leo_bd` | Bloquear implementação até confirmar o nome oficial |
| API | `doGet`/`doPost` expõem CRUD/consulta por ações externas | Servir apenas a UI em `doGet` e manter operações internas no canal `google.script.run`, salvo requisito explícito de integração externa |
| Clickjacking | Interface usa `XFrameOptionsMode.ALLOWALL` | Remover `ALLOWALL` se incorporação em domínio externo não for requisito homologado |
| Identidade | UUID pseudoaleatório e valores padrão inventados | Usar `Utilities.getUuid()` e rejeitar dados ausentes/inválidos |
| Concorrência | Escritas sem bloqueio | Usar `LockService` nas mutações e escrita em lote |
| Validação | Conversões permissivas transformam entradas inválidas em zero | Validar no cliente por UX e novamente no servidor como autoridade |
| Datas/horas | Strings e datas misturadas; valores fixos em 2026 | Definir timezone único e contrato ISO (`yyyy-MM-dd`, `HH:mm`) |
| Desempenho | Frontend recalcula tudo a partir de todos os registros | Um bootstrap agregado no servidor e consultas paginadas; minimizar chamadas e acesso à planilha |
| Erros | Mensagens técnicas e contratos inconsistentes | Envelope de resposta estável, mensagens amigáveis e log técnico no GAS |
| PWA | Inexistente | Adicionar metadados/manifesto e experiência instalável compatível com as limitações do HtmlService; homologar expectativa de uso offline |
| Acessibilidade | Modal e feedbacks sem fluxo completo de foco/estado | Incluir navegação por teclado, foco, ARIA, contraste e estados de carregamento |

## 4. Arquitetura proposta

### 4.1 Stack e responsabilidades

```text
Navegador
└── index.html (single-file)
    ├── Vue 3 via CDN
    ├── CSS mobile-first + tokens SAE + glassmorphism
    ├── Chart.js via CDN
    ├── estado, filtros, modal, tabelas e feedback visual
    └── Gateway Promise para google.script.run
                │
                ▼
Google Apps Script V8
└── codigo.gs
    ├── doGet → HtmlService
    ├── autenticação/autorização e configuração
    ├── validação e normalização
    ├── consultas e agregações
    ├── CRUD transacional com LockService
    └── acesso em lote ao Sheets
                │
                ▼
Google Sheets — aba homologada (uma linha = um lançamento)
```

Não haverá React, JSX, bundler, Babel, banco externo ou API REST exposta sem uma
necessidade de integração formalmente homologada.

### 4.2 Configuração

- `SPREADSHEET_ID`: constante server-side com o ID homologado, nunca recebida do
  navegador.
- `SHEET_NAME`: constante após homologação entre `Leo_db` e `Leo_bd`.
- `APP_TIMEZONE`: timezone homologado e também configurado no projeto GAS e na
  planilha.
- IDs e configurações sensíveis não serão devolvidos no payload do cliente.

### 4.3 Modelo de dados mínimo

| Coluna | Tipo lógico | Regra |
| --- | --- | --- |
| `UUID` | string UUID | Gerado pelo servidor, único e imutável |
| `data` | data | Recebida como ISO `yyyy-MM-dd`, persistida como data real no Sheets |
| `horario_inicio` | horário | `HH:mm`, obrigatório |
| `horario_fim` | horário | `HH:mm`, obrigatório e posterior ao início |
| `valor` | número | Finito, normalizado, maior ou igual a zero; formato monetário só na apresentação |
| `pedido` | número inteiro | Quantidade de pedidos do lançamento, maior ou igual a zero |

Recomendação para auditabilidade de produção: acrescentar `criado_em`,
`atualizado_em` e `criado_por`. Isso é uma evolução de esquema e depende de
aprovação antes da implementação.

### 4.4 Contrato interno do backend

Todas as funções chamadas pela UI retornarão um envelope previsível:

```js
{ ok: true, data: {}, meta: {} }
{ ok: false, error: { code: 'VALIDATION_ERROR', message: '...' } }
```

Operações planejadas:

- `getAppBootstrap(filters)`: configuração pública, KPIs, séries e comparador.
- `listOrders(query)`: paginação real no servidor, busca, ordenação e total.
- `createOrder(input)`: valida e cria com UUID.
- `updateOrder(input)`: valida UUID e altera uma única linha.
- `deleteOrder(input)`: valida UUID e exclui após confirmação na UI.
- `getDashboard(filters)`: recarrega métricas após filtros ou mutações.

Os nomes finais podem ser refinados na implementação, mas o navegador jamais
decidirá linha da planilha, fórmula de KPI, autorização ou UUID.

## 5. Regras de cálculo propostas

### 5.1 Dimensões de data

- **Dia:** `data === diaSelecionado`.
- **Mês:** mesmo ano e mês do filtro selecionado.
- **Ano:** mesmo ano do contexto selecionado.
- **Data comparativa:** `diaSelecionado - 7 dias`, calculada no timezone do app.
- O “atual” será derivado do relógio do servidor no timezone homologado, não de
  valores fixos nem exclusivamente do relógio do dispositivo.

### 5.2 Faturamento e pedidos

- **Faturamento:** soma de `valor` dos registros válidos no recorte.
- **Pedidos:** soma dos valores numéricos da coluna `pedido` nos lançamentos do
  recorte; a quantidade de linhas nunca é usada como quantidade de pedidos.
- Um lançamento com `pedido = 0` continua nas tabelas e agrupamentos para comprovar
  que aquela faixa foi registrada, mas adiciona zero aos indicadores.
- Meses/dias históricos sem movimento podem aparecer com zero quando necessários
  para preservar uma linha temporal compreensível.
- No gráfico por horário, faixas sem registro serão omitidas conforme solicitado.

### 5.3 Agrupamento de horário

- A chave será o par normalizado `horario_inicio|horario_fim`, exibido como
  `HH:mm – HH:mm`.
- A ordenação será pela hora inicial e, em empate, pela hora final.
- Os períodos serão baseados nos intervalos lançados, sem criar automaticamente
  as 24 faixas vazias.

### 5.4 Ranking

- O Top 3 será calculado por série e por métrica.
- Proposta de desempate: maior valor/quantidade, depois período cronologicamente
  mais recente.
- As três posições terão cores/selos distintos e acessíveis; os demais pontos
  manterão a cor base.
- É preciso homologar se “Top 3 mensal” significa os três melhores **meses da
  série**, os três melhores **dias do mês** ou ambos. A proposta é destacar em
  todos os gráficos onde existam ao menos três pontos.

### 5.5 Comparador e projeção

Para uma faixa `p`:

```text
referencia(p) = pedidos na data selecionada - 7 dias, na mesma faixa
realizado(p)  = pedidos na data selecionada, na mesma faixa
faltante(p)   = max(referencia(p) - realizado(p), 0)
saldo(p)      = realizado(p) - referencia(p)
```

- `faltante > 0`: abaixo da referência.
- `faltante = 0` e `saldo = 0`: referência igualada.
- `saldo > 0`: referência superada.
- Uma faixa futura é uma faixa cuja hora inicial ainda não ocorreu no dia de
  operação; se o usuário consultar uma data histórica/futura, a interface deverá
  explicar o contexto em vez de usar indevidamente a hora corrente.
- A estimativa de faturamento adicional só será exibida se for homologada uma
  fórmula. Sugestão: `faltante × ticket médio` da mesma faixa na semana anterior;
  sem amostra, não projetar valor.

## 6. Segurança, integridade e operação

- Implantar com a menor exposição possível e definir quem pode acessar o Web App.
- Validar e normalizar todo input no GAS; o frontend é apenas a primeira camada
  de UX.
- Escapar conteúdo exibido e evitar interpolar HTML vindo da planilha.
- Remover endpoints de mutação via `doPost` enquanto não houver autenticação de
  integração, assinatura e necessidade real.
- Usar bloqueio de script nas mutações para impedir colisões simultâneas.
- Ler/escrever ranges em lote e evitar chamadas célula a célula.
- Nunca confiar em número de linha enviado pelo cliente; localizar por UUID no
  servidor.
- Bloquear UUID duplicado e validar `pedido` como quantidade inteira não negativa.
- Registrar erros técnicos em `console.error` no GAS e retornar ao usuário apenas
  mensagens úteis, sem stack trace ou detalhes internos.
- Exibir skeletons, loader estilo Google, estado vazio, retry e bloquear duplo
  clique durante mutações.
- A exclusão física é o escopo atualmente pedido. Para ERP auditável, recomenda-se
  exclusão lógica, mas essa mudança depende de homologação.

## 7. UX/UI e responsividade

- Paleta CSS fornecida será preservada como fonte de verdade.
- Layout mobile-first: sidebar vira navegação compacta/drawer; cards em uma coluna;
  gráficos com altura legível; tabelas com rolagem ou cartões responsivos.
- Componentes visuais: Glass Sidebar, Header, Cards, Modal, List/Table, Skeleton,
  Toast e confirmação destrutiva.
- Modal acessível: foco inicial, contenção de foco, fechamento por `Esc`, rótulos,
  erro por campo e retorno do foco ao botão de origem.
- Gráficos terão tooltip em pt-BR, moeda brasileira, legenda textual para ranking
  e alternativa resumida para leitores de tela.
- Rodapé: `@2026SAE - Planilha LEO`, conforme solicitado.
- PWA: incluir metadados, ícones e manifesto compatíveis com Web App GAS. O grau
  de funcionamento offline precisa ser homologado, pois CRUD e dados reais
  dependem de conexão com `google.script.run` e o ambiente HtmlService impõe
  limitações ao controle por service worker.

## 8. Plano de execução após homologação

### Fase 0 — Decisões bloqueantes

1. Responder às questões da seção 10.
2. Congelar regras de cálculo, timezone, schema e política de acesso.
3. Definir critérios de aceite e massa de dados não produtiva para testes.

### Fase 1 — Fundação do backend

1. Configurar planilha pelo ID homologado no backend e validar schema sem destruir dados.
2. Criar normalizadores, validadores, envelopes de resposta e tratamento de erro.
3. Implementar repositório Sheets com leitura/escrita em lote e bloqueios.
4. Implementar CRUD por UUID e testes manuais controlados em cópia da planilha.

### Fase 2 — Consultas analíticas

1. Implementar filtros e agregações de faturamento/pedidos.
2. Implementar séries mensais, diárias e horárias sem intervalos fictícios.
3. Implementar ranking Top 3 e desempates.
4. Implementar comparador D-7 e projeção homologada.

### Fase 3 — Frontend Vue 3

1. Migrar a interface para uma aplicação Vue 3 single-file via CDN.
2. Criar gateway Promise para `google.script.run` com handlers de sucesso/falha.
3. Conectar dashboard e estados loading/error/empty.
4. Conectar modal, CRUD, paginação, busca, confirmação e atualização reativa.
5. Aplicar acessibilidade, mobile-first, animações leves e PWA possível no GAS.

### Fase 4 — Qualidade e publicação

1. Validar regras com casos de borda: virada de mês/ano, DST/timezone, empate,
   período sem base, intervalo inválido, duplicidade e concorrência.
2. Testar celular e desktop, teclado, erros de rede e volume representativo.
3. Executar homologação em cópia da planilha; nunca popular produção com mocks.
4. Documentar instalação, propriedades, permissões, implantação e rollback.
5. Publicar versão do Web App somente após aceite funcional.

## 9. Critérios de aceite propostos

- Nenhum dado demonstrativo/local é usado em produção.
- Criar, editar e excluir refletem corretamente no Sheets e em todos os KPIs.
- Entradas inválidas não gravam parcial ou silenciosamente valor zero.
- Todas as métricas conciliam com uma soma/contagem manual da mesma amostra.
- Filtros alteram apenas o escopo definido e indicam claramente o contexto.
- Gráficos horários não exibem faixas vazias e o Top 3 é consistente.
- Comparador usa exatamente D-7 e informa ausência de base.
- “Salvar e novo” mantém o modal aberto sem duplicar o envio anterior.
- Paginação apresenta 20 itens por página, total correto e ordenação definida.
- Duas gravações simultâneas não geram UUID duplicado nem linha incompleta.
- Não existe CRUD público anônimo por query string/POST sem controle formal.
- Interface funciona nos breakpoints móveis e desktop homologados.

## 10. Pendências não bloqueantes

- Homologar posteriormente se a auditoria exigirá colunas `criado_em`,
  `atualizado_em`, `criado_por` e exclusão lógica.
- Confirmar se períodos poderão atravessar meia-noite; a versão inicial exige que
  a hora final seja posterior à inicial no mesmo dia.
- Definir se a PWA deverá ser apenas instalável ou possuir uma tela offline. CRUD e
  indicadores reais sempre dependerão de conexão com o GAS.

## 11. Referências oficiais previstas para a implementação

- [Comunicação entre HTML Service e funções do servidor (`google.script.run`)](https://developers.google.com/apps-script/guides/html/communication)
- [Boas práticas do Apps Script](https://developers.google.com/apps-script/guides/support/best-practices)
- [Lock Service](https://developers.google.com/apps-script/reference/lock/lock-service)
- [Properties Service](https://developers.google.com/apps-script/guides/properties)
- [Spreadsheet Service](https://developers.google.com/apps-script/reference/spreadsheet)
- [Web Apps com Apps Script](https://developers.google.com/apps-script/guides/web)

Essas referências devem ser revisitadas nas manutenções do projeto. O ambiente local
não conseguiu acessá-las durante esta execução por restrição do proxy.

## 12. Implantação

1. Instalar e autenticar o `clasp` em uma estação administrativa.
2. Obter o **ID do projeto de script** no editor do Apps Script e criar `.clasp.json`;
   o ID de implantação Web App (`AKfy...`) não substitui o ID do projeto.
3. Conferir o `SPREADSHEET_ID` server-side antes de publicar.
4. Executar `clasp push`, criar uma nova versão e atualizar a implantação para
   executar como proprietário com acesso para qualquer pessoa.
5. Validar o CRUD em uma cópia da planilha antes de apontar para produção.

## 13. Divisão do capital

A feature homologada está implementada com configuração dinâmica, snapshots,
repasses, mini KPIs e exclusão lógica. A especificação e as decisões consolidadas
estão em
[`docs/DIVISAO_CAPITAL_ESPECIFICACAO.md`](docs/DIVISAO_CAPITAL_ESPECIFICACAO.md).
Antes do primeiro uso, execute `setupCapitalModule()` ou utilize “Preparar módulo”
na página Configurações para garantir as três entidades e os registros iniciais.
