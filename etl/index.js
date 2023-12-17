const { Client } = require('pg');
const { fakerRU: faker } = require('@faker-js/faker');

const client = new Client({
    user: 'testsystem',
    host: 'db',
    database: 'testsystem',
    password: 'zir8VqA23AL18U56DKyEhQ',
    port: 5432,
});

const educationLevels = ['bachelor', 'specialty', 'master', 'postgraduate'];
const educationLevelMapping = { bachelor: 'Б', specialty: 'С', master: 'М', postgraduate: 'А' };

const getIds = async (table) => {
    const res = await client.query({text: `SELECT id FROM "${table}"`, rowMode: 'array'});

    return res.rows.map(row => row[0]);
}

const insertList = async (table, list, types) => {
    if (list.length > 0) {
        const columns = Object.keys(list[0]);
        const query = `INSERT INTO "${table}" (${columns.join(', ')}) ` +
            `SELECT * FROM UNNEST (${columns.map((_, i) => '$' + (i + 1) + '::' + types[i] + '[]').join(', ')}) RETURNING id`;
        let values = columns.map(_ => []);

        for (let row of list) {
            columns.forEach((column, i) => {
                values[i].push(row[column]);
            })
        }

        const result = await client.query(query, values);

        return result.rows.map(row => row.id);
    }
    return [];
}

const getAcademicTests = async () => {
    const res = await client.query(`
SELECT 
    test.id, 
    array_agg(DISTINCT variant.id) as variants, 
    passing_grade, 
    is_checked_manually,
    start_time,
    end_time,
    max_attempt_time,
    max_attempts_count,
    array_agg(DISTINCT student.id) as students,
    array_agg(DISTINCT teacher.id) as teachers
FROM 
    variant 
    JOIN test 
        ON test.id = variant.test_id 
    JOIN subject
        ON test.subject_id = subject.id
    JOIN teacher_group_subject AS tgs
        ON subject.id = tgs.subject_id
    JOIN "group"
        ON tgs.group_id = "group".id
    JOIN student 
        ON "group".id = student.group_id
    JOIN teacher
        ON tgs.teacher_id = teacher.id
WHERE 
    test.type = 'academic' 
GROUP BY 
    test.id
`);

    return res.rows
}

const getPsychologicalTests = async () => {
    const res = await client.query(`
SELECT 
    test.id, 
    array_agg(DISTINCT variant.id) as variants, 
    start_time,
    end_time,
    array_agg(DISTINCT student.id) as students
FROM 
    variant 
    JOIN test 
        ON test.id = variant.test_id 
    JOIN group_test
        ON test.id = group_test.test_id
    JOIN "group"
        ON group_test.group_id = "group".id
    JOIN student 
        ON "group".id = student.group_id
WHERE 
    test.type = 'psychological' 
GROUP BY 
    test.id
`);

    return res.rows
}

const getVariantQuestions = async (variantId) => {
    const res = await client.query(`
SELECT
    question.id,
    points,
    MAX(cq.id) as choice_question_id,
    MAX(iq.id) as input_question_id,
    MAX(oq.id) as open_question_id,
    STRING_AGG(iq.correct_answer, '') as correct_answer,
    ARRAY_AGG(answer_variant.id) AS answer_variant_ids,
    ARRAY_AGG(answer_variant.is_correct) AS answer_variant_correct
FROM
    variant
    JOIN question
        ON variant.id = question.variant_id
    LEFT JOIN choice_question cq
        ON question.id = cq.question_id
    LEFT JOIN input_question iq
        ON question.id = iq.question_id
    LEFT JOIN open_question oq
        ON question.id = oq.question_id
    LEFT JOIN answer_variant
        ON cq.id = answer_variant.choice_question_id
WHERE
    variant.id = $1
GROUP BY
    question.id
`, [variantId]);
    return res.rows;
}

const getPsychologicalTest = async (name) => {
    const res = await client.query(`SELECT variant.id
FROM variant JOIN test ON test.id = variant.test_id WHERE test.type = 'psychological' AND test.name = $1`, [name]);

    return res.rows[0];
}

const insertPsychologicalQuestions = async (variant, questionTexts) => {
    const questions = [];
    const choiceQuestions = [];

    questionTexts.forEach((text, i) => {
        questions.push({
            variant_id: variant.id,
            number: i + 1,
            text,
            points: null
        });
    });

    const questionIds = await insertList('question', questions, ['integer', 'integer', 'text', 'integer']);

    questionIds.forEach((question_id, i) => {
        choiceQuestions.push({
            question_id,
            can_choose_multiple: false,
            is_order_random: false,
        });
    });

    return await insertList('choice_question', choiceQuestions, ['integer', 'boolean', 'boolean']);
}

const userTypes = ['varchar(100)', 'varchar(100)', 'varchar(100)', 'varchar(255)', 'varchar(255)', 'timestamp', 'timestamp']

const createUser = () => {
    const sex = faker.person.sexType();
    const first_name = faker.person.firstName(sex);
    const last_name = faker.person.lastName(sex);
    const patronymic = faker.person.middleName(sex);

    const now = new Date();
    const registration_date = faker.date.between({ from: now.setFullYear(now.getFullYear() - 2), to: now });

    return {
        first_name,
        last_name,
        patronymic,
        login: faker.internet.email({ firstName: first_name, lastName: last_name }),
        password: faker.internet.password(),
        registration_date: registration_date,
        last_login_date: faker.date.between({ from: registration_date, to: now}),
    }
}

const pgIntervalToTimestamp = (interval) => {
    return (3600 * (interval.hours || 0) + 60 * (interval.minutes || 0) + interval.seconds) * 1000;
}

const getQuestionType = (isCheckedManually) => {
    let rand = Math.random();
    if (isCheckedManually) {
        if (rand < 0.7) {
            return 'choice_question';
        }
        else if (rand < 0.9) {
            return 'input_question';
        }
        else {
            return 'open_question';
        }
    }
    else {
        if (rand < 0.75) {
            return 'choice_question';
        }
        else {
            return 'input_question';
        }
    }
}

const fillUsers = async () => {
    let groupIds = await getIds('group');

    if (groupIds.length === 0) {
        console.log('Filling groups');
        let groups = [];

        for (let i = 0; i < 100; i++) {
            const education_level = faker.helpers.arrayElement(educationLevels);
            const admission_year = faker.number.int({min: 2022, max: 2023});
            const department = faker.number.int({min: 1, max: 9});
            const code = [];

            for (let j = 0; j < 3; j++) {
                code.push(faker.number.int({min: 1, max: 99}).toString().padStart(2, '0'));
            }

            groups.push({
                number: `${educationLevelMapping[education_level]}${admission_year % 100}-` +
                    `${department}${faker.number.int({min: 1, max: 29}).toString().padStart(2, '0')}`,
                admission_year,
                education_level,
                department,
                specialty_code: code.join('.')
            });
        }
        groupIds = await insertList('group', groups, ['char(7)', 'smallint', 'education_levels', 'smallint', 'char(8)']);
    }
    else {
        console.log('Groups filled, skipping');
    }

    let studentIds = await getIds('student');

    if (studentIds.length === 0) {
        console.log('Filling students');
        for (let groupId of groupIds) {
            let studentCount = faker.number.int({min: 10, max: 25});
            const users = Array.from({ length: studentCount }, createUser);
            const userIds = await insertList('user', users, userTypes);

            const students = userIds.map(userId => ({ user_id: userId, group_id: groupId }));
            await insertList('student', students, ['integer', 'integer']);
        }
    }
    else {
        console.log('students filled, skipping');
    }

    let teacherIds = await getIds('teacher');

    if (teacherIds.length === 0) {
        console.log('Filling teachers');
        const users = Array.from({ length: 400 }, createUser);
        const userIds = await insertList('user', users, userTypes);

        const teachers = userIds.map(userId => ({
            user_id: userId,
            academic_degree: faker.helpers.arrayElement(['Кандидат наук', 'Доктор наук']),
            position: faker.helpers.arrayElement(['Ассистент', 'Доцент', 'Профессор'])
        }));
        teacherIds = await insertList('teacher', teachers, ['integer', 'varchar(50)', 'varchar(50)']);
    }
    else {
        console.log('teachers filled, skipping');
    }

    let employeeIds = await getIds('employee');

    if (employeeIds.length === 0) {
        console.log('Filling employees');
        const users = Array.from({ length: 25 }, createUser);
        const userIds = await insertList('user', users, userTypes);

        const employees = userIds.map(userId => ({
            user_id: userId,
            role: faker.helpers.arrayElement(['department', 'psychologist', 'department', 'psychologist', 'admin']),
        }));
        employeeIds = await insertList('employee', employees, ['integer', 'roles']);
    }
    else {
        console.log('employees filled, skipping');
    }

    let subjectIds = await getIds('subject');

    if (subjectIds.length === 0) {
        console.log('Filling subjects');
        const subjects = [];

        for (let i = 0; i < 160; i++) {
            subjects.push({
                name: faker.company.buzzPhrase()
            })
        }

        subjectIds = await insertList('subject', subjects, ['varchar(255)']);
    }
    else {
        console.log('subjects filled, skipping');
    }

    let teacherGroupSubjectIds = await getIds('teacher_group_subject');

    if (teacherGroupSubjectIds.length === 0) {
        console.log('Filling teacherGroupSubjects');
        const teacherGroupSubjects = [];

        for (let group_id of groupIds) {
            const curSubjects = faker.helpers.arrayElements(subjectIds, faker.number.int({min: 5, max: 15}));

            for (let subject_id of curSubjects) {
                const curTeachers = faker.helpers.arrayElements(teacherIds, faker.number.int({min: 1, max: 3}));

                for (let teacher_id of curTeachers) {
                    teacherGroupSubjects.push({
                        teacher_id,
                        subject_id,
                        group_id
                    })
                }
            }
        }

        teacherGroupSubjectIds = await insertList('teacher_group_subject', teacherGroupSubjects, ['integer', 'integer', 'integer']);
    }
    else {
        console.log('teacherGroupSubjects filled, skipping');
    }

    let testIds = await getIds('test');

    if (testIds.length === 0) {
        console.log('Filling academic tests');
        let tests = [];

        for (let subject_id of subjectIds) {
            for (let i = 0; i < faker.number.int({min: 1, max: 3}); i++) {
                const now = new Date();
                const twoYearsAgo = (new Date()).setFullYear(now.getFullYear() - 2)
                const start_time = faker.date.between({ from: twoYearsAgo, to: now });
                const end_time = faker.date.between({ from: start_time, to: (new Date(start_time)).setHours(24 * 14) });

                tests.push({
                    name: faker.lorem.words({min: 2, max: 10}),
                    type: 'academic',
                    start_time,
                    end_time,
                    passing_grade: faker.helpers.arrayElement([6, 15, 30]),
                    max_attempt_time: faker.number.int({min: 5 * 60, max: 3 * 60 * 60}),
                    max_attempts_count: faker.helpers.arrayElement([1, faker.number.int({ min: 2, max: 5 })]),
                    is_checked_manually: Math.random() > 0.95,
                    is_question_order_random: Math.random() > 0.5,
                    subject_id
                });
            }
        }

        let academicTestIds = await insertList('test', tests, ['varchar(255)', 'test_types', 'timestamp',
            'timestamp', 'integer', 'interval', 'integer', 'boolean', 'boolean', 'integer']);

        let variants = [];

        for (let test_id of academicTestIds) {
            for (let i = 0; i < faker.helpers.arrayElement([1, faker.number.int({ min: 2, max: 4 })]); i++) {
                variants.push({
                    number: i + 1,
                    test_id
                });
            }
        }

        await insertList('variant', variants, ['integer', 'integer']);

        console.log('Filling psychological tests');

        tests = [];

        const now = new Date();
        tests.push({
            name: 'Пятифакторный опросник личности, 5PFQ',
            type: 'psychological',
            start_time: faker.date.between({ from: now.setFullYear(now.getFullYear() - 2), to: now }),
            end_time: null,
            passing_grade: null,
            max_attempt_time: null,
            max_attempts_count: 1,
            is_checked_manually: false,
            is_question_order_random: true,
            subject_id: null
        });
        tests.push({
            name: 'Диагностика ведущей перцептивной модальности',
            type: 'psychological',
            start_time: faker.date.between({ from: now.setFullYear(now.getFullYear() - 2), to: now }),
            end_time: null,
            passing_grade: null,
            max_attempt_time: null,
            max_attempts_count: 1,
            is_checked_manually: false,
            is_question_order_random: true,
            subject_id: null
        });
        tests.push({
            name: 'Тест эмоционального интеллекта Холла',
            type: 'psychological',
            start_time: faker.date.between({ from: now.setFullYear(now.getFullYear() - 2), to: now }),
            end_time: null,
            passing_grade: null,
            max_attempt_time: null,
            max_attempts_count: 1,
            is_checked_manually: false,
            is_question_order_random: true,
            subject_id: null
        });

        let psychologicalTestsIds = await insertList('test', tests, ['varchar(255)', 'test_types', 'timestamp',
            'timestamp', 'integer', 'interval', 'integer', 'boolean', 'boolean', 'integer']);

        variants = [];
        let groupTests = [];

        for (let test_id of psychologicalTestsIds) {
            variants.push({
                number: 1,
                test_id
            });

            for (let i = 0; i < faker.number.int({min: 3, max: 10}); i++) {
                groupTests.push({
                    test_id,
                    group_id: faker.helpers.arrayElement(groupIds)
                })
            }
        }

        await insertList('variant', variants, ['integer', 'integer']);
        await insertList('group_test', groupTests, ['integer', 'integer']);


        const academicTests = await getAcademicTests();

        for (let test of academicTests) {
            console.log('Filling questions');
            let questionCount;
            if (test.passing_grade === 6) {
                questionCount = faker.helpers.arrayElement([5, 10, 10]);
            }
            else if (test.passing_grade === 15) {
                questionCount = faker.helpers.arrayElement([5, 25]);
            }
            else {
                questionCount = faker.helpers.arrayElement([5, 10, 10, 25]);
            }

            let questionTypes = Array.from({length: questionCount}, () => getQuestionType(test.is_checked_manually));
            let choiceOrderRandom = Math.random() > 0.5;

            for (let variant of test.variants) {
                let questions = [];

                questionTypes.forEach((questionType, i) => {
                    questions.push({
                        variant_id: variant,
                        number: i + 1,
                        text: faker.lorem.text(),
                        points: test.passing_grade / 0.6 / questionCount,
                    })
                });

                const questionIds = await insertList('question', questions, ['integer', 'integer', 'text', 'integer']);

                const typedQuestions = {
                    choice_question: [],
                    input_question: [],
                    open_question: [],
                }

                questionTypes.forEach((questionType, i) => {
                    let typedQuestion = {
                        question_id: questionIds[i]
                    }

                    if (questionType === 'choice_question') {
                        typedQuestion.can_choose_multiple = Math.random() > 0.75;
                        typedQuestion.is_order_random = choiceOrderRandom;
                    }
                    else if (questionType === 'input_question') {
                        typedQuestion.correct_answer = faker.helpers.arrayElement([faker.lorem.word(), faker.number.int(1000)])
                    }
                    else {
                        typedQuestion.criteria = faker.lorem.text()
                    }

                    typedQuestions[questionType].push(typedQuestion)
                });

                const choiceQuestionIds = await insertList('choice_question', typedQuestions['choice_question'], ['integer', 'boolean', 'boolean']);
                const inputQuestionIds = await insertList('input_question', typedQuestions['input_question'], ['integer', 'varchar(255)']);
                const openQuestionIds = await insertList('open_question', typedQuestions['open_question'], ['integer', 'text']);

                const answerVariants = [];

                choiceQuestionIds.forEach((choiceQuestionId, i) => {
                    const question = typedQuestions['choice_question'][i];
                    let answerCount;
                    let correctAnswers;

                    if (question.can_choose_multiple) {
                        answerCount = 6;
                        correctAnswers = Array.from({length: answerCount}, () => Math.random() > 0.5);
                    }
                    else {
                        answerCount = 4;
                        let correctVariant = faker.number.int({min: 0, max: 3});
                        correctAnswers = Array.from({length: answerCount}, (_, i) => i === correctVariant);
                    }

                    for (let is_correct of correctAnswers) {
                        answerVariants.push({
                            choice_question_id: choiceQuestionId,
                            text: faker.lorem.words({min: 1, max: 10}),
                            is_correct
                        });
                    }
                });

                const answerVariantIds = await insertList('answer_variant', answerVariants, ['integer', 'varchar(255)', 'boolean']);
            }
        }

        console.log('Filling psychological answers')
        console.log('5fpq answers')

        const fpfq = await getPsychologicalTest('Пятифакторный опросник личности, 5PFQ');
        let questionTexts = require('./5pfq');

        let answerVariants = [];

        let choiceQuestionIds = await insertPsychologicalQuestions(fpfq, questionTexts)

        choiceQuestionIds.forEach((choiceQuestionId) => {

            for (let i = -2; i <= 2; i++) {
                answerVariants.push({
                    choice_question_id: choiceQuestionId,
                    text: i.toString(),
                    is_correct: null
                });
            }
        });

        await insertList('answer_variant', answerVariants, ['integer', 'varchar(255)', 'boolean']);

        console.log('modal answers')

        const modal = await getPsychologicalTest('Диагностика ведущей перцептивной модальности');
        questionTexts = require('./modal');

        answerVariants = [];

        choiceQuestionIds = await insertPsychologicalQuestions(modal, questionTexts)

        choiceQuestionIds.forEach((choiceQuestionId) => {

            for (let i of ['+', '-']) {
                answerVariants.push({
                    choice_question_id: choiceQuestionId,
                    text: i.toString(),
                    is_correct: null
                });
            }
        });

        await insertList('answer_variant', answerVariants, ['integer', 'varchar(255)', 'boolean']);

        console.log('hall answers')

        const hall = await getPsychologicalTest('Тест эмоционального интеллекта Холла');
        questionTexts = require('./hall');

        answerVariants = [];

        choiceQuestionIds = await insertPsychologicalQuestions(hall, questionTexts)

        choiceQuestionIds.forEach((choiceQuestionId) => {

            for (let i of ['Полностью не согласен', 'В основном не согласен', 'Отчасти не согласен',
                'Отчасти согласен', 'В основном согласен', 'Полностью согласен']) {
                answerVariants.push({
                    choice_question_id: choiceQuestionId,
                    text: i.toString(),
                    is_correct: null
                });
            }
        });

        await insertList('answer_variant', answerVariants, ['integer', 'varchar(255)', 'boolean']);

    }
    else {
        console.log('tests filled, skipping');
    }

    const attemptIds = await getIds('attempt');

    if (attemptIds.length === 0) {
        console.log('Filling attempts');

        const academicTests = await getAcademicTests();

        let testCounter = 0;
        for (let test of academicTests) {
            console.log(`processing test ${++testCounter} of ${academicTests.length}`);

            const attempts = [];
            const answers = {};
            const chosenVariants = {};

            for (let student of test.students) {
                if (Math.random() > 0.8) {
                    continue;
                }

                const variant_id = faker.helpers.arrayElement(test.variants);

                const attemptCount = faker.number.int({min: 1, max: test.max_attempts_count});

                let curLastTime = test.start_time.getTime();

                const estimatedAttemptTime = (test.end_time.getTime() - curLastTime) / (attemptCount);

                for (let i = 0; i < attemptCount; i++) {
                    const start_time = test.start_time.getTime() + estimatedAttemptTime + i;
                    const maxAttemptTime = pgIntervalToTimestamp(test.max_attempt_time)
                    const end_time = faker.date.between({
                        from: start_time + (maxAttemptTime / 2),
                        to: start_time + maxAttemptTime,
                    })
                    curLastTime = end_time;
                    let is_checked = Math.random() < 0.5;

                    const attemptIndex = attempts.push({
                        start_time: new Date(start_time),
                        end_time,
                        is_checked: test.is_checked_manually ? is_checked : null,
                        student_id: student,
                        checking_teacher_id: test.is_checked_manually ? faker.helpers.arrayElement(test.teachers) : null,
                        variant_id
                    }) - 1;

                    answers[attemptIndex] = [];
                    chosenVariants[attemptIndex] = {};

                    const questions = await getVariantQuestions(variant_id);

                    for (let question of questions) {
                        const answer = {
                            question_id: question.id,
                        };
                        let curChosenVariants = [];

                        if (question.choice_question_id) {
                            if (question.answer_variant_ids.length === 4) {
                                const answerIndex = faker.number.int({min: 0, max: 3});

                                curChosenVariants.push({
                                    answer_variant_id: question.answer_variant_ids[answerIndex]
                                });

                                answer.text = null;
                                answer.points = question.answer_variant_correct[answerIndex] ? question.points : 0
                            }
                            else {
                                const answerCount = faker.number.int({min: 0, max: 6});
                                const answerVariantIds = faker.helpers.arrayElements(question.answer_variant_ids, answerCount);

                                for (let answer_variant_id of answerVariantIds) {
                                    curChosenVariants.push({
                                        answer_variant_id
                                    });
                                }

                                answer.text = null;
                                answer.points = faker.number.int({min: 0, max: question.points});
                            }
                        }
                        else if (question.input_question_id) {
                            if (Math.random() < 0.5) {
                                answer.text = faker.lorem.word();
                                answer.points = 0;
                            }
                            else {
                                answer.text = question.correct_answer;
                                answer.points = question.points;
                            }
                        }
                        else if (question.open_question_id) {
                            answer.text = faker.lorem.text();
                            answer.points = is_checked ? faker.number.int({min: 0, max: question.points}) : null;
                        }


                        const answerIndex = answers[attemptIndex].push(answer) - 1;
                        chosenVariants[attemptIndex][answerIndex] = curChosenVariants;

                        // console.log(answer);
                    }
                }

                // console.log()
            }

            const attemptIds = await insertList('attempt', attempts, ['timestamp', 'timestamp', 'boolean', 'integer', 'integer', 'integer']);

            attemptIds.forEach((id, i) => {
                // console.log(i, answers[i], id)
                for (let answer of answers[i]) {
                    answer.attempt_id = id;
                }
            });

            const flatAnswers = Object.values(answers).reduce((a, b) => a.concat(b));
            const answerIds = await insertList('answer', flatAnswers, ['integer', 'text', 'integer', 'integer']);

            let counter = 0;
            for (let attemptIndex in answers) {
                for (let answerIndex in answers[attemptIndex]) {
                    for (let variant of chosenVariants[attemptIndex][answerIndex]) {
                        variant.answer_id = answerIds[counter];
                    }
                    counter++;
                }
            }

            const flatChosenVariants = Object.values(chosenVariants)
                .map(x => Object.values(x).reduce((a, b) => a.concat(b)))
                .reduce((a, b) => a.concat(b));

            const chosenVariantIds = await insertList('chosen_variant', flatChosenVariants, ['integer', 'integer']);

        }

        console.log('Filling psychological attempts');

        const psychologicalTest = await getPsychologicalTests();



        let psyTestCounter = 0;
        for (let test of psychologicalTest) {
            console.log(`processing test ${++psyTestCounter} of ${psychologicalTest.length}`);

            const attempts = [];
            const answers = {};
            const chosenVariants = {};

            // let iii = 0
            for (let student of test.students) {
                if (Math.random() > 0.8) {
                    continue;
                }
                // console.log(++iii)
                const variant_id = faker.helpers.arrayElement(test.variants);

                const attemptCount = 1;

                for (let i = 0; i < attemptCount; i++) {

                    const start_time = faker.date.between({from: test.start_time, to: new Date()});

                    const attemptIndex = attempts.push({
                        start_time,
                        end_time: faker.date.between({from: start_time, to: start_time.getTime() + 3600000}),
                        is_checked: null,
                        student_id: student,
                        checking_teacher_id: null,
                        variant_id
                    }) - 1;

                    answers[attemptIndex] = [];
                    chosenVariants[attemptIndex] = {};

                    const questions = await getVariantQuestions(variant_id);

                    for (let question of questions) {
                        const answer = {
                            question_id: question.id,
                        };
                        let curChosenVariants = [];

                        if (question.choice_question_id) {
                            const answerIndex = faker.number.int({min: 0, max: question.answer_variant_ids.length - 1});

                            curChosenVariants.push({
                                answer_variant_id: question.answer_variant_ids[answerIndex]
                            });

                            answer.text = null;
                            answer.points = null;
                        }


                        const answerIndex = answers[attemptIndex].push(answer) - 1;
                        chosenVariants[attemptIndex][answerIndex] = curChosenVariants;

                        // console.log(answer);
                    }
                }

                // console.log()
            }

            const attemptIds = await insertList('attempt', attempts, ['timestamp', 'timestamp', 'boolean', 'integer', 'integer', 'integer']);

            attemptIds.forEach((id, i) => {
                // console.log(i, answers[i], id)
                for (let answer of answers[i]) {
                    answer.attempt_id = id;
                }
            });

            const flatAnswers = Object.values(answers).reduce((a, b) => a.concat(b));
            const answerIds = await insertList('answer', flatAnswers, ['integer', 'text', 'integer', 'integer']);

            let counter = 0;
            for (let attemptIndex in answers) {
                for (let answerIndex in answers[attemptIndex]) {
                    for (let variant of chosenVariants[attemptIndex][answerIndex]) {
                        variant.answer_id = answerIds[counter];
                    }
                    counter++;
                }
            }

            const flatChosenVariants = Object.values(chosenVariants)
                .map(x => Object.values(x).reduce((a, b) => a.concat(b)))
                .reduce((a, b) => a.concat(b));

            const chosenVariantIds = await insertList('chosen_variant', flatChosenVariants, ['integer', 'integer']);

        }
    }
}

(async () => {
    await client.connect();


    await fillUsers();

    await client.end();
})();
