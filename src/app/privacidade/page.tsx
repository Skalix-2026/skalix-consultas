import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade · Skalix Consultas",
  description: "Como o Skalix Consultas trata os dados de pacientes e clínicas.",
};

export default function Privacidade() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-gray-800 leading-relaxed">
      <h1 className="text-3xl font-semibold">Política de Privacidade</h1>
      <p className="mt-2 text-sm text-gray-500">Skalix Consultas · Última atualização: 16 de outubro de 2026</p>

      <h2 className="mt-8 text-xl font-semibold">1. Quem somos</h2>
      <p className="mt-2">
        O Skalix Consultas é um serviço operado pela Skalix (contato: ti@skalix.com.br) que ajuda clínicas e consultórios a
        confirmar consultas e exames com seus pacientes por meio do WhatsApp. Nesta relação, a clínica é a controladora dos
        dados pessoais e a Skalix atua como operadora, nos termos da Lei Geral de Proteção de Dados (Lei 13.709/2018).
      </p>

      <h2 className="mt-8 text-xl font-semibold">2. Quais dados tratamos</h2>
      <p className="mt-2">
        Tratamos apenas o necessário para confirmar um agendamento: nome do paciente, número de telefone, tipo de atendimento
        (por exemplo, consulta de cardiologia ou exame de ultrassonografia), data e horário, nome do profissional e o
        conteúdo das mensagens trocadas sobre a confirmação. Não coletamos nem armazenamos diagnósticos, prontuários,
        resultados de exames ou qualquer outro dado clínico.
      </p>

      <h2 className="mt-8 text-xl font-semibold">3. Para que usamos</h2>
      <p className="mt-2">
        Para enviar a mensagem de confirmação, lembretes e cobranças de resposta; para registrar a resposta do paciente
        (confirmação, cancelamento ou pedido de remarcação); e para atualizar a agenda da clínica. Usamos inteligência
        artificial apenas para interpretar o texto da resposta e classificá-la; nenhuma decisão clínica é tomada pelo sistema.
      </p>

      <h2 className="mt-8 text-xl font-semibold">4. Com quem compartilhamos</h2>
      <p className="mt-2">
        Com a Meta Platforms (WhatsApp Business Platform), para entrega das mensagens; com provedores de infraestrutura
        (hospedagem e banco de dados) e de inteligência artificial, que recebem somente o mínimo necessário, com dados pessoais
        mascarados sempre que possível. Não vendemos nem cedemos dados a terceiros para fins de marketing.
      </p>

      <h2 className="mt-8 text-xl font-semibold">5. Por quanto tempo guardamos</h2>
      <p className="mt-2">
        Os registros de agendamento e as mensagens são mantidos pelo período definido com a clínica e serão excluídos ou
        anonimizados quando deixarem de ser necessários, conforme definido com a clínica.
      </p>
      <p className="mt-2">
        Após 90 dias, o texto das mensagens recebidas dos pacientes (e o registro bruto do evento do WhatsApp que o contém,
        incluindo o número de telefone) é substituído por um marcador. Permanecem somente metadados da classificação
        (intenção e grau de confiança) e as datas.
      </p>

      <h2 className="mt-8 text-xl font-semibold">6. Segurança</h2>
      <p className="mt-2">
        Os dados trafegam criptografados, ficam armazenados em servidores no Brasil com acesso restrito por usuário e perfil,
        e os números de telefone são exibidos de forma parcial na interface. Todo acesso é registrado.
      </p>

      <h2 className="mt-8 text-xl font-semibold">7. Seus direitos</h2>
      <p className="mt-2">
        Você pode solicitar à clínica, a qualquer momento, a confirmação do tratamento, o acesso, a correção ou a exclusão dos
        seus dados, e pode parar de receber mensagens respondendo com a palavra SAIR. Dúvidas sobre esta política podem ser
        enviadas para ti@skalix.com.br.
      </p>

      <h2 className="mt-8 text-xl font-semibold">8. Alterações</h2>
      <p className="mt-2">
        Esta política pode ser atualizada; a data no topo indica a versão vigente.
      </p>
    </main>
  );
}
