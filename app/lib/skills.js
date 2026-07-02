// Shared tech-skills vocabulary. Used by BOTH the server (to extract skills from
// job descriptions) and the browser (to extract skills from the resume) so the
// two sides speak the same language. [ key, label, regexSource ]
export const SKILLS = [
  ["javascript", "JavaScript", "javascript|\\bjs\\b"],
  ["typescript", "TypeScript", "typescript|\\bts\\b"],
  ["react", "React", "react(?:\\.js)?|reactjs"],
  ["nextjs", "Next.js", "next\\.?js"],
  ["vue", "Vue", "vue(?:\\.js)?"],
  ["angular", "Angular", "angular"],
  ["svelte", "Svelte", "svelte"],
  ["node", "Node.js", "node(?:\\.js)?"],
  ["python", "Python", "python"],
  ["java", "Java", "\\bjava\\b"],
  ["kotlin", "Kotlin", "kotlin"],
  ["swift", "Swift", "\\bswift\\b"],
  ["go", "Go", "golang|\\bgo\\b"],
  ["rust", "Rust", "\\brust\\b"],
  ["cpp", "C++", "c\\+\\+"],
  ["csharp", "C#", "c#|csharp|\\.net"],
  ["ruby", "Ruby / Rails", "\\bruby\\b|\\brails\\b"],
  ["php", "PHP", "\\bphp\\b"],
  ["scala", "Scala", "\\bscala\\b"],
  ["elixir", "Elixir", "elixir"],
  ["django", "Django", "django"],
  ["flask", "Flask", "flask"],
  ["fastapi", "FastAPI", "fastapi"],
  ["spring", "Spring", "spring boot|spring framework|\\bspring\\b"],
  ["express", "Express", "express(?:\\.js)?"],
  ["dotnet", ".NET", "\\.net|asp\\.net"],
  ["graphql", "GraphQL", "graphql"],
  ["rest", "REST APIs", "\\brest\\b|restful|rest api"],
  ["grpc", "gRPC", "grpc"],
  ["html", "HTML", "\\bhtml5?\\b"],
  ["css", "CSS", "\\bcss3?\\b|tailwind|\\bscss\\b|sass"],
  ["aws", "AWS", "\\baws\\b|amazon web services"],
  ["gcp", "GCP", "\\bgcp\\b|google cloud"],
  ["azure", "Azure", "\\bazure\\b"],
  ["docker", "Docker", "docker"],
  ["kubernetes", "Kubernetes", "kubernetes|\\bk8s\\b"],
  ["terraform", "Terraform", "terraform"],
  ["ansible", "Ansible", "ansible"],
  ["cicd", "CI/CD", "ci/cd|jenkins|github actions|gitlab ci|circleci"],
  ["linux", "Linux", "\\blinux\\b|\\bunix\\b"],
  ["sql", "SQL", "\\bsql\\b"],
  ["postgres", "PostgreSQL", "postgres(?:ql)?"],
  ["mysql", "MySQL", "mysql"],
  ["mongodb", "MongoDB", "mongo(?:db)?"],
  ["redis", "Redis", "redis"],
  ["elasticsearch", "Elasticsearch", "elasticsearch"],
  ["kafka", "Kafka", "kafka"],
  ["rabbitmq", "RabbitMQ", "rabbitmq"],
  ["spark", "Spark", "\\bspark\\b"],
  ["hadoop", "Hadoop", "hadoop"],
  ["airflow", "Airflow", "airflow"],
  ["snowflake", "Snowflake", "snowflake"],
  ["dbt", "dbt", "\\bdbt\\b"],
  ["tableau", "Tableau", "tableau|power bi"],
  ["ml", "Machine Learning", "machine learning|\\bml\\b"],
  ["dl", "Deep Learning", "deep learning|neural network"],
  ["pytorch", "PyTorch", "pytorch"],
  ["tensorflow", "TensorFlow", "tensorflow"],
  ["nlp", "NLP", "\\bnlp\\b|natural language"],
  ["llm", "LLMs / GenAI", "\\bllm\\b|large language model|generative ai|\\bgenai\\b|\\brag\\b"],
  ["cv", "Computer Vision", "computer vision|opencv"],
  ["pandas", "Pandas / NumPy", "pandas|numpy"],
  ["dataeng", "Data Engineering", "data engineering|\\betl\\b|data pipeline"],
  ["microservices", "Microservices", "microservices|micro-services"],
  ["distributed", "Distributed Systems", "distributed systems"],
  ["devops", "DevOps", "devops"],
  ["sre", "SRE", "\\bsre\\b|site reliability"],
  ["security", "Security", "cybersecurity|infosec|application security"],
  ["android", "Android", "android"],
  ["ios", "iOS", "\\bios\\b"],
  ["flutter", "Flutter", "flutter"],
  ["reactnative", "React Native", "react native"],
  ["git", "Git", "\\bgit\\b|github|gitlab"],
  ["agile", "Agile / Scrum", "agile|scrum|kanban"],
];

const MATCHERS = SKILLS.map(([key, , src]) => [key, new RegExp(src, "i")]);
const LABELS = Object.fromEntries(SKILLS.map(([k, l]) => [k, l]));

export function extractSkills(text = "") {
  if (!text) return [];
  const found = [];
  for (const [key, re] of MATCHERS) {
    if (re.test(text)) found.push(key);
  }
  return found;
}

export function skillLabel(key) {
  return LABELS[key] || key;
}
