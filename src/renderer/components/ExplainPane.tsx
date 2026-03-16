import ReactMarkdown from 'react-markdown';
import './ExplainPane.css';

interface ExplanationData {
  summary: string;
  breakdown: string[];
  expectedOutcome: string;
  failureModes: string[];
  undoGuidance: string | null;
}

interface ExplainPaneProps {
  explanation: ExplanationData | null;
  isLoading: boolean;
  selectedCommand: any;
}

function parseExplanation(exp: any): ExplanationData | null {
  if (!exp) return null;

  // If it's a string (raw JSON or markdown), try to parse it
  if (typeof exp === 'string') {
    try {
      return JSON.parse(exp);
    } catch {
      return { summary: exp, breakdown: [], expectedOutcome: '', failureModes: [], undoGuidance: null };
    }
  }

  // If summary is a JSON string, try to parse it
  if (typeof exp.summary === 'string' && exp.summary.startsWith('{')) {
    try {
      const parsed = JSON.parse(exp.summary);
      return { ...exp, ...parsed };
    } catch {}
  }

  return exp;
}

export default function ExplainPane({ explanation: rawExplanation, isLoading, selectedCommand }: ExplainPaneProps) {
  const explanation = parseExplanation(rawExplanation);

  return (
    <div className="pane explain-pane">
      <div className="pane-header">
        <span>Explain</span>
      </div>

      <div className="pane-content">
        {isLoading && (
          <div className="loading">
            <div className="spinner" />
            <p>Analyzing...</p>
          </div>
        )}

        {!isLoading && !explanation && (
          <div className="empty-state">
            <p>Click a command in History to see an explanation.</p>
          </div>
        )}

        {!isLoading && explanation && (
          <div className="explanation">
            {selectedCommand && (
              <div className="command-display">
                <code>{selectedCommand.input}</code>
              </div>
            )}

            {explanation.summary && (
              <section>
                <h3>Summary</h3>
                <div className="explain-markdown">
                  <ReactMarkdown>{explanation.summary}</ReactMarkdown>
                </div>
              </section>
            )}

            {explanation.breakdown && explanation.breakdown.length > 0 && (
              <section>
                <h3>Breakdown</h3>
                <ul>
                  {explanation.breakdown.map((item, i) => (
                    <li key={i}>
                      <ReactMarkdown>{item}</ReactMarkdown>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {explanation.expectedOutcome && (
              <section>
                <h3>Expected Outcome</h3>
                <div className="explain-markdown">
                  <ReactMarkdown>{explanation.expectedOutcome}</ReactMarkdown>
                </div>
              </section>
            )}

            {explanation.failureModes && explanation.failureModes.length > 0 && (
              <section>
                <h3>Common Failures</h3>
                <ul>
                  {explanation.failureModes.map((mode, i) => (
                    <li key={i}>{mode}</li>
                  ))}
                </ul>
              </section>
            )}

            {explanation.undoGuidance && (
              <section className="undo-section">
                <h3>How to Undo</h3>
                <div className="explain-markdown">
                  <ReactMarkdown>{explanation.undoGuidance}</ReactMarkdown>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
